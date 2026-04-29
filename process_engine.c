/*
 * ════════════════════════════════════════════════════════════════════════════
 *  PROCESS LIFECYCLE VISUALIZATION TOOL — C BACKEND
 *  ────────────────────────────────────────────────────────────────────────
 *  A standalone HTTP server that simulates OS process scheduling.
 *  Implements: FCFS, Round Robin, SJF, SRTF, Priority, Priority(Preemptive)
 *
 *  Compile:  gcc -o process_server.exe process_engine.c -lws2_32
 *  Run:      process_server.exe
 *  Open:     http://localhost:9090
 * ════════════════════════════════════════════════════════════════════════════
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <winsock2.h>
#include <ws2tcpip.h>

#pragma comment(lib, "ws2_32.lib")

/* ═══════════════════════════════════════════════════════════
 *  CONSTANTS
 * ═══════════════════════════════════════════════════════════ */
#define MAX_PROCESSES   128
#define MAX_EVENTS      80
#define MAX_GANTT       120
#define PORT            9090
#define BUF_SIZE        8192
#define JSON_BUF_SIZE   65536

/* ═══════════════════════════════════════════════════════════
 *  ENUMS & STRUCTS
 * ═══════════════════════════════════════════════════════════ */
typedef enum {
    STATE_NEW,
    STATE_READY,
    STATE_RUNNING,
    STATE_WAITING,
    STATE_TERMINATED
} ProcessState;

typedef enum {
    ALGO_FCFS,
    ALGO_RR,
    ALGO_PRIORITY,
    ALGO_SJF,
    ALGO_SRTF,
    ALGO_PRIORITY_P
} Algorithm;

typedef struct {
    int pid;
    int priority;
    int burstTime;
    int remainingTime;
    int arrivalTime;
    ProcessState state;
    int waitTime;
    int cpuTime;
    int startTime;   /* -1 = not started */
    int finishTime;  /* -1 = not finished */
    int memUsage;
    int ioCountdown;
    int colorIndex;
    int active;      /* 1 = exists, 0 = slot free */
} Process;

typedef struct {
    int tick;
    int pid;
    char msg[128];
    char cls[8];     /* ec, ea, ed, ei, ep, ef */
} Event;

typedef struct {
    int tick;
    int pid;       /* -1 = idle */
    int colorIndex;
} GanttEntry;

/* Event fired during a single tick */
typedef struct {
    char type[32];   /* e.g. "new-ready", "ready-running" */
    int pid;
    int tick;
    char msg[128];
    char cls[8];
} TickEvent;

typedef struct {
    Process procs[MAX_PROCESSES];
    int procCount;

    /* Queue indices (store PIDs) */
    int newQ[MAX_PROCESSES];     int newQLen;
    int readyQ[MAX_PROCESSES];   int readyQLen;
    int waitQ[MAX_PROCESSES];    int waitQLen;
    int runningPid;              /* -1 = none */
    int donePids[MAX_PROCESSES]; int doneCount;

    int clock;
    int nextPid;
    Algorithm algorithm;
    int quantum;
    int quantumCounter;
    int busyTicks;
    int ctxSwitches;

    Event events[MAX_EVENTS];
    int eventCount;

    GanttEntry gantt[MAX_GANTT];
    int ganttCount;

    /* Tick events for current tick */
    TickEvent tickEvents[32];
    int tickEventCount;
} Kernel;

/* ═══════════════════════════════════════════════════════════
 *  GLOBAL KERNEL
 * ═══════════════════════════════════════════════════════════ */
static Kernel K;

static const char* COLORS[] = {
    "#f43f5e","#22d3ee","#fbbf24","#fb923c","#a78bfa",
    "#34d399","#f472b6","#60a5fa","#a3e635","#e879f9"
};
#define NUM_COLORS 10

/* ═══════════════════════════════════════════════════════════
 *  PROCESS HELPERS
 * ═══════════════════════════════════════════════════════════ */

static Process* find_proc(int pid) {
    for (int i = 0; i < K.procCount; i++) {
        if (K.procs[i].active && K.procs[i].pid == pid)
            return &K.procs[i];
    }
    return NULL;
}

static const char* state_str(ProcessState s) {
    switch(s) {
        case STATE_NEW:        return "new";
        case STATE_READY:      return "ready";
        case STATE_RUNNING:    return "running";
        case STATE_WAITING:    return "waiting";
        case STATE_TERMINATED: return "terminated";
    }
    return "unknown";
}

static const char* algo_str(Algorithm a) {
    switch(a) {
        case ALGO_FCFS:       return "FCFS";
        case ALGO_RR:         return "RR";
        case ALGO_PRIORITY:   return "Priority";
        case ALGO_SJF:        return "SJF";
        case ALGO_SRTF:       return "SRTF";
        case ALGO_PRIORITY_P: return "PriorityP";
    }
    return "FCFS";
}

static Algorithm parse_algo(const char* s) {
    if (strcmp(s, "FCFS") == 0)       return ALGO_FCFS;
    if (strcmp(s, "RR") == 0)         return ALGO_RR;
    if (strcmp(s, "Priority") == 0)   return ALGO_PRIORITY;
    if (strcmp(s, "SJF") == 0)        return ALGO_SJF;
    if (strcmp(s, "SRTF") == 0)       return ALGO_SRTF;
    if (strcmp(s, "PriorityP") == 0)  return ALGO_PRIORITY_P;
    return ALGO_FCFS;
}

/* ═══════════════════════════════════════════════════════════
 *  KERNEL FUNCTIONS
 * ═══════════════════════════════════════════════════════════ */

static void kernel_init(void) {
    memset(&K, 0, sizeof(Kernel));
    K.runningPid = -1;
    K.nextPid = 100;
    K.algorithm = ALGO_RR;
    K.quantum = 3;
    srand((unsigned int)time(NULL));
}

static void kernel_reset(void) {
    kernel_init();
}

static void add_event(int tick, int pid, const char* msg, const char* cls) {
    /* Shift events down (newest at index 0) */
    if (K.eventCount < MAX_EVENTS)
        K.eventCount++;
    for (int i = K.eventCount - 1; i > 0; i--)
        K.events[i] = K.events[i-1];

    K.events[0].tick = tick;
    K.events[0].pid = pid;
    strncpy(K.events[0].msg, msg, 127);
    K.events[0].msg[127] = '\0';
    strncpy(K.events[0].cls, cls, 7);
    K.events[0].cls[7] = '\0';
}

static void add_tick_event(const char* type, int pid, int tick, const char* msg, const char* cls) {
    if (K.tickEventCount >= 32) return;
    TickEvent* te = &K.tickEvents[K.tickEventCount++];
    strncpy(te->type, type, 31); te->type[31] = '\0';
    te->pid = pid;
    te->tick = tick;
    strncpy(te->msg, msg, 127); te->msg[127] = '\0';
    strncpy(te->cls, cls, 7); te->cls[7] = '\0';
}

static int kernel_create_process(int pri, int burst) {
    if (K.procCount >= MAX_PROCESSES) return -1;

    Process* p = &K.procs[K.procCount];
    memset(p, 0, sizeof(Process));
    p->pid = K.nextPid++;
    p->priority = pri < 1 ? 1 : (pri > 10 ? 10 : pri);
    p->burstTime = burst;
    p->remainingTime = burst;
    p->arrivalTime = K.clock;
    p->state = STATE_NEW;
    p->startTime = -1;
    p->finishTime = -1;
    p->memUsage = (rand() % 180) + 40;
    p->ioCountdown = 0;
    p->colorIndex = p->pid % NUM_COLORS;
    p->active = 1;

    K.newQ[K.newQLen++] = p->pid;
    K.procCount++;

    char buf[128];
    snprintf(buf, 128, "Created - burst=%d pri=%d", burst, pri);
    add_event(K.clock, p->pid, buf, "ec");

    return p->pid;
}

/* Remove pid from a queue */
static void queue_remove(int* q, int* len, int idx) {
    for (int i = idx; i < *len - 1; i++)
        q[i] = q[i+1];
    (*len)--;
}

/* Find index of pid in queue */
static int queue_find(int* q, int len, int pid) {
    for (int i = 0; i < len; i++)
        if (q[i] == pid) return i;
    return -1;
}

/* Sort ready queue by criteria */
static void sort_ready_by_priority(void) {
    /* Simple bubble sort (small arrays) */
    for (int i = 0; i < K.readyQLen - 1; i++) {
        for (int j = 0; j < K.readyQLen - 1 - i; j++) {
            Process* a = find_proc(K.readyQ[j]);
            Process* b = find_proc(K.readyQ[j+1]);
            if (a && b) {
                int swap = 0;
                if (a->priority > b->priority) swap = 1;
                else if (a->priority == b->priority && a->arrivalTime > b->arrivalTime) swap = 1;
                if (swap) {
                    int tmp = K.readyQ[j];
                    K.readyQ[j] = K.readyQ[j+1];
                    K.readyQ[j+1] = tmp;
                }
            }
        }
    }
}

static void sort_ready_by_remaining(void) {
    for (int i = 0; i < K.readyQLen - 1; i++) {
        for (int j = 0; j < K.readyQLen - 1 - i; j++) {
            Process* a = find_proc(K.readyQ[j]);
            Process* b = find_proc(K.readyQ[j+1]);
            if (a && b) {
                int swap = 0;
                if (a->remainingTime > b->remainingTime) swap = 1;
                else if (a->remainingTime == b->remainingTime && a->arrivalTime > b->arrivalTime) swap = 1;
                if (swap) {
                    int tmp = K.readyQ[j];
                    K.readyQ[j] = K.readyQ[j+1];
                    K.readyQ[j+1] = tmp;
                }
            }
        }
    }
}

/* ═══════════════════════════════════════════════════════════
 *  KERNEL TICK — Main simulation step
 * ═══════════════════════════════════════════════════════════ */
static void kernel_tick(void) {
    K.clock++;
    K.tickEventCount = 0;
    int Q = K.quantum > 0 ? K.quantum : 3;
    char buf[128];

    /* 1. Admit new → ready */
    for (int i = 0; i < K.newQLen; i++) {
        Process* p = find_proc(K.newQ[i]);
        if (!p) continue;
        p->state = STATE_READY;
        K.readyQ[K.readyQLen++] = p->pid;

        snprintf(buf, 128, "Admitted -> Ready Queue");
        add_event(K.clock, p->pid, buf, "ea");
        add_tick_event("new-ready", p->pid, K.clock, buf, "ea");
    }
    K.newQLen = 0;

    /* 2. Preemptive check (SRTF / PriorityP) */
    if (K.runningPid >= 0 && K.readyQLen > 0) {
        Process* running = find_proc(K.runningPid);

        if (K.algorithm == ALGO_SRTF && running) {
            /* Find shortest in ready queue */
            int shortIdx = 0;
            Process* shortest = find_proc(K.readyQ[0]);
            for (int i = 1; i < K.readyQLen; i++) {
                Process* c = find_proc(K.readyQ[i]);
                if (c && shortest && c->remainingTime < shortest->remainingTime) {
                    shortest = c;
                    shortIdx = i;
                }
            }
            if (shortest && shortest->remainingTime < running->remainingTime) {
                running->state = STATE_READY;
                K.readyQ[K.readyQLen++] = running->pid;
                K.ctxSwitches++;
                snprintf(buf, 128, "Preempted by P%d (shorter burst)", shortest->pid);
                add_event(K.clock, running->pid, buf, "ep");
                add_tick_event("running-ready", running->pid, K.clock, buf, "ep");
                K.runningPid = -1;
            }
        }
        else if (K.algorithm == ALGO_PRIORITY_P && running) {
            int highIdx = 0;
            Process* highest = find_proc(K.readyQ[0]);
            for (int i = 1; i < K.readyQLen; i++) {
                Process* c = find_proc(K.readyQ[i]);
                if (c && highest && c->priority < highest->priority) {
                    highest = c;
                    highIdx = i;
                }
            }
            if (highest && highest->priority < running->priority) {
                running->state = STATE_READY;
                K.readyQ[K.readyQLen++] = running->pid;
                K.ctxSwitches++;
                snprintf(buf, 128, "Preempted by P%d (higher priority)", highest->pid);
                add_event(K.clock, running->pid, buf, "ep");
                add_tick_event("running-ready", running->pid, K.clock, buf, "ep");
                K.runningPid = -1;
            }
        }
    }

    /* 3. Tick running process */
    if (K.runningPid >= 0) {
        Process* p = find_proc(K.runningPid);
        if (p) {
            p->cpuTime++;
            p->remainingTime--;
            K.busyTicks++;
            K.quantumCounter++;

            if (p->remainingTime <= 0) {
                /* Process finished */
                p->state = STATE_TERMINATED;
                p->finishTime = K.clock;
                K.donePids[K.doneCount++] = p->pid;
                K.ctxSwitches++;
                snprintf(buf, 128, "Finished - Process terminated");
                add_event(K.clock, p->pid, buf, "ef");
                add_tick_event("running-terminated", p->pid, K.clock, buf, "ef");
                K.runningPid = -1;
            }
            else if ((rand() % 1000) < 42 && p->cpuTime > 1) {
                /* Random I/O request (~4.2% chance) */
                p->state = STATE_WAITING;
                p->ioCountdown = (rand() % 7) + 3;
                K.waitQ[K.waitQLen++] = p->pid;
                K.ctxSwitches++;
                snprintf(buf, 128, "I/O request - blocked for %d ticks", p->ioCountdown);
                add_event(K.clock, p->pid, buf, "ei");
                add_tick_event("running-waiting", p->pid, K.clock, buf, "ei");
                K.runningPid = -1;
            }
            else if (K.algorithm == ALGO_RR && K.quantumCounter >= Q) {
                /* Quantum expired */
                p->state = STATE_READY;
                K.readyQ[K.readyQLen++] = p->pid;
                K.ctxSwitches++;
                snprintf(buf, 128, "Quantum expired - preempted -> Ready");
                add_event(K.clock, p->pid, buf, "ep");
                add_tick_event("running-ready", p->pid, K.clock, buf, "ep");
                K.runningPid = -1;
            }
        }
    }

    /* 4. Tick waiting queue — decrement I/O countdown */
    int newWaitQ[MAX_PROCESSES];
    int newWaitQLen = 0;
    for (int i = 0; i < K.waitQLen; i++) {
        Process* p = find_proc(K.waitQ[i]);
        if (!p) continue;
        p->ioCountdown--;
        p->waitTime++;

        if (p->ioCountdown <= 0) {
            /* I/O complete */
            p->state = STATE_READY;
            K.readyQ[K.readyQLen++] = p->pid;
            snprintf(buf, 128, "I/O complete - back to Ready Queue");
            add_event(K.clock, p->pid, buf, "ea");
            add_tick_event("waiting-ready", p->pid, K.clock, buf, "ea");
        } else {
            newWaitQ[newWaitQLen++] = p->pid;
        }
    }
    memcpy(K.waitQ, newWaitQ, newWaitQLen * sizeof(int));
    K.waitQLen = newWaitQLen;

    /* 5. Increment wait time for ready queue processes */
    for (int i = 0; i < K.readyQLen; i++) {
        Process* p = find_proc(K.readyQ[i]);
        if (p) p->waitTime++;
    }

    /* 6. Schedule next process */
    if (K.runningPid < 0 && K.readyQLen > 0) {
        int nextPid = -1;

        switch (K.algorithm) {
            case ALGO_FCFS:
            case ALGO_RR:
                nextPid = K.readyQ[0];
                queue_remove(K.readyQ, &K.readyQLen, 0);
                break;

            case ALGO_PRIORITY:
            case ALGO_PRIORITY_P:
                sort_ready_by_priority();
                nextPid = K.readyQ[0];
                queue_remove(K.readyQ, &K.readyQLen, 0);
                break;

            case ALGO_SJF:
            case ALGO_SRTF:
                sort_ready_by_remaining();
                nextPid = K.readyQ[0];
                queue_remove(K.readyQ, &K.readyQLen, 0);
                break;
        }

        if (nextPid >= 0) {
            Process* next = find_proc(nextPid);
            if (next) {
                next->state = STATE_RUNNING;
                if (next->startTime < 0) next->startTime = K.clock;
                K.runningPid = nextPid;
                K.quantumCounter = 0;

                snprintf(buf, 128, "Dispatched -> CPU by %s", algo_str(K.algorithm));
                add_event(K.clock, next->pid, buf, "ed");
                add_tick_event("ready-running", next->pid, K.clock, buf, "ed");
            }
        }
    }

    /* 7. Record Gantt entry */
    if (K.ganttCount < MAX_GANTT) {
        K.gantt[K.ganttCount].tick = K.clock;
        K.gantt[K.ganttCount].pid = K.runningPid;
        K.gantt[K.ganttCount].colorIndex = K.runningPid >= 0 ?
            (find_proc(K.runningPid) ? find_proc(K.runningPid)->colorIndex : 0) : -1;
        K.ganttCount++;
    } else {
        /* Shift gantt log */
        for (int i = 0; i < MAX_GANTT - 1; i++)
            K.gantt[i] = K.gantt[i+1];
        K.gantt[MAX_GANTT-1].tick = K.clock;
        K.gantt[MAX_GANTT-1].pid = K.runningPid;
        K.gantt[MAX_GANTT-1].colorIndex = K.runningPid >= 0 ?
            (find_proc(K.runningPid) ? find_proc(K.runningPid)->colorIndex : 0) : -1;
    }
}

/* ═══════════════════════════════════════════════════════════
 *  METRICS
 * ═══════════════════════════════════════════════════════════ */
static int kernel_ram_used(void) {
    int total = 0;
    for (int i = 0; i < K.procCount; i++) {
        if (K.procs[i].active && K.procs[i].state != STATE_TERMINATED)
            total += K.procs[i].memUsage;
    }
    return total;
}

static int kernel_cpu_util(void) {
    return K.clock > 0 ? (K.busyTicks * 100 / K.clock) : 0;
}

static double kernel_avg_wait(void) {
    if (K.doneCount == 0) return -1;
    int total = 0;
    for (int i = 0; i < K.doneCount; i++) {
        Process* p = find_proc(K.donePids[i]);
        if (p) total += p->waitTime;
    }
    return (double)total / K.doneCount;
}

static double kernel_avg_tat(void) {
    if (K.doneCount == 0) return -1;
    int total = 0;
    for (int i = 0; i < K.doneCount; i++) {
        Process* p = find_proc(K.donePids[i]);
        if (p && p->finishTime >= 0)
            total += (p->finishTime - p->arrivalTime);
    }
    return (double)total / K.doneCount;
}

static double kernel_avg_response(void) {
    int count = 0, total = 0;
    for (int i = 0; i < K.doneCount; i++) {
        Process* p = find_proc(K.donePids[i]);
        if (p && p->startTime >= 0) {
            total += (p->startTime - p->arrivalTime);
            count++;
        }
    }
    return count > 0 ? (double)total / count : -1;
}

/* ═══════════════════════════════════════════════════════════
 *  JSON SERIALIZATION
 * ═══════════════════════════════════════════════════════════ */
static char json_buf[JSON_BUF_SIZE];

static void escape_json_str(char* dest, const char* src, int maxlen) {
    int j = 0;
    for (int i = 0; src[i] && j < maxlen - 2; i++) {
        if (src[i] == '"' || src[i] == '\\') {
            dest[j++] = '\\';
        }
        dest[j++] = src[i];
    }
    dest[j] = '\0';
}

static char* build_state_json(void) {
    int pos = 0;
    char escaped[256];

    pos += snprintf(json_buf + pos, JSON_BUF_SIZE - pos, "{");

    /* Clock & config */
    pos += snprintf(json_buf + pos, JSON_BUF_SIZE - pos,
        "\"clock\":%d,\"algorithm\":\"%s\",\"quantum\":%d,\"quantumCounter\":%d,",
        K.clock, algo_str(K.algorithm), K.quantum, K.quantumCounter);

    /* Metrics */
    double aw = kernel_avg_wait();
    double at = kernel_avg_tat();
    double ar = kernel_avg_response();
    pos += snprintf(json_buf + pos, JSON_BUF_SIZE - pos,
        "\"cpuUtil\":%d,\"ramUsed\":%d,\"ctxSwitches\":%d,\"busyTicks\":%d,",
        kernel_cpu_util(), kernel_ram_used(), K.ctxSwitches, K.busyTicks);
    if (aw >= 0) pos += snprintf(json_buf + pos, JSON_BUF_SIZE - pos, "\"avgWait\":%.1f,", aw);
    else pos += snprintf(json_buf + pos, JSON_BUF_SIZE - pos, "\"avgWait\":null,");
    if (at >= 0) pos += snprintf(json_buf + pos, JSON_BUF_SIZE - pos, "\"avgTAT\":%.1f,", at);
    else pos += snprintf(json_buf + pos, JSON_BUF_SIZE - pos, "\"avgTAT\":null,");
    if (ar >= 0) pos += snprintf(json_buf + pos, JSON_BUF_SIZE - pos, "\"avgResponse\":%.1f,", ar);
    else pos += snprintf(json_buf + pos, JSON_BUF_SIZE - pos, "\"avgResponse\":null,");

    /* Running PID */
    pos += snprintf(json_buf + pos, JSON_BUF_SIZE - pos,
        "\"runningPid\":%d,", K.runningPid);

    /* Queue lengths */
    pos += snprintf(json_buf + pos, JSON_BUF_SIZE - pos,
        "\"newQLen\":%d,\"readyQLen\":%d,\"waitQLen\":%d,\"doneCount\":%d,",
        K.newQLen, K.readyQLen, K.waitQLen, K.doneCount);

    /* All processes */
    pos += snprintf(json_buf + pos, JSON_BUF_SIZE - pos, "\"processes\":[");
    for (int i = 0; i < K.procCount; i++) {
        Process* p = &K.procs[i];
        if (!p->active) continue;
        if (i > 0) pos += snprintf(json_buf + pos, JSON_BUF_SIZE - pos, ",");
        pos += snprintf(json_buf + pos, JSON_BUF_SIZE - pos,
            "{\"pid\":%d,\"priority\":%d,\"burstTime\":%d,\"remainingTime\":%d,"
            "\"arrivalTime\":%d,\"state\":\"%s\",\"waitTime\":%d,\"cpuTime\":%d,"
            "\"startTime\":%d,\"finishTime\":%d,\"memUsage\":%d,\"ioCountdown\":%d,"
            "\"colorIndex\":%d,\"color\":\"%s\"}",
            p->pid, p->priority, p->burstTime, p->remainingTime,
            p->arrivalTime, state_str(p->state), p->waitTime, p->cpuTime,
            p->startTime, p->finishTime, p->memUsage, p->ioCountdown,
            p->colorIndex, COLORS[p->colorIndex]);
    }
    pos += snprintf(json_buf + pos, JSON_BUF_SIZE - pos, "],");

    /* Ready Queue (ordered) */
    pos += snprintf(json_buf + pos, JSON_BUF_SIZE - pos, "\"readyQ\":[");
    for (int i = 0; i < K.readyQLen; i++) {
        if (i > 0) pos += snprintf(json_buf + pos, JSON_BUF_SIZE - pos, ",");
        pos += snprintf(json_buf + pos, JSON_BUF_SIZE - pos, "%d", K.readyQ[i]);
    }
    pos += snprintf(json_buf + pos, JSON_BUF_SIZE - pos, "],");

    /* Wait Queue */
    pos += snprintf(json_buf + pos, JSON_BUF_SIZE - pos, "\"waitQ\":[");
    for (int i = 0; i < K.waitQLen; i++) {
        if (i > 0) pos += snprintf(json_buf + pos, JSON_BUF_SIZE - pos, ",");
        pos += snprintf(json_buf + pos, JSON_BUF_SIZE - pos, "%d", K.waitQ[i]);
    }
    pos += snprintf(json_buf + pos, JSON_BUF_SIZE - pos, "],");

    /* Done PIDs */
    pos += snprintf(json_buf + pos, JSON_BUF_SIZE - pos, "\"donePids\":[");
    for (int i = 0; i < K.doneCount; i++) {
        if (i > 0) pos += snprintf(json_buf + pos, JSON_BUF_SIZE - pos, ",");
        pos += snprintf(json_buf + pos, JSON_BUF_SIZE - pos, "%d", K.donePids[i]);
    }
    pos += snprintf(json_buf + pos, JSON_BUF_SIZE - pos, "],");

    /* Events log */
    pos += snprintf(json_buf + pos, JSON_BUF_SIZE - pos, "\"events\":[");
    for (int i = 0; i < K.eventCount && i < 30; i++) {
        if (i > 0) pos += snprintf(json_buf + pos, JSON_BUF_SIZE - pos, ",");
        escape_json_str(escaped, K.events[i].msg, 255);
        pos += snprintf(json_buf + pos, JSON_BUF_SIZE - pos,
            "{\"t\":%d,\"pid\":%d,\"msg\":\"%s\",\"cls\":\"%s\"}",
            K.events[i].tick, K.events[i].pid, escaped, K.events[i].cls);
    }
    pos += snprintf(json_buf + pos, JSON_BUF_SIZE - pos, "],");

    /* Tick events (transitions that happened this tick) */
    pos += snprintf(json_buf + pos, JSON_BUF_SIZE - pos, "\"tickEvents\":[");
    for (int i = 0; i < K.tickEventCount; i++) {
        if (i > 0) pos += snprintf(json_buf + pos, JSON_BUF_SIZE - pos, ",");
        escape_json_str(escaped, K.tickEvents[i].msg, 255);
        pos += snprintf(json_buf + pos, JSON_BUF_SIZE - pos,
            "{\"type\":\"%s\",\"pid\":%d,\"t\":%d,\"msg\":\"%s\",\"cls\":\"%s\"}",
            K.tickEvents[i].type, K.tickEvents[i].pid, K.tickEvents[i].tick,
            escaped, K.tickEvents[i].cls);
    }
    pos += snprintf(json_buf + pos, JSON_BUF_SIZE - pos, "],");

    /* Gantt log */
    pos += snprintf(json_buf + pos, JSON_BUF_SIZE - pos, "\"gantt\":[");
    for (int i = 0; i < K.ganttCount; i++) {
        if (i > 0) pos += snprintf(json_buf + pos, JSON_BUF_SIZE - pos, ",");
        if (K.gantt[i].pid >= 0) {
            pos += snprintf(json_buf + pos, JSON_BUF_SIZE - pos,
                "{\"t\":%d,\"pid\":%d,\"color\":\"%s\"}",
                K.gantt[i].tick, K.gantt[i].pid,
                COLORS[K.gantt[i].colorIndex % NUM_COLORS]);
        } else {
            pos += snprintf(json_buf + pos, JSON_BUF_SIZE - pos,
                "{\"t\":%d,\"pid\":null,\"color\":null}", K.gantt[i].tick);
        }
    }
    pos += snprintf(json_buf + pos, JSON_BUF_SIZE - pos, "]");

    pos += snprintf(json_buf + pos, JSON_BUF_SIZE - pos, "}");

    return json_buf;
}

/* ═══════════════════════════════════════════════════════════
 *  SIMPLE JSON FIELD PARSER
 * ═══════════════════════════════════════════════════════════ */
static int json_get_int(const char* json, const char* key, int def) {
    char search[64];
    snprintf(search, 64, "\"%s\":", key);
    const char* p = strstr(json, search);
    if (!p) return def;
    p += strlen(search);
    while (*p == ' ') p++;
    return atoi(p);
}

static void json_get_str(const char* json, const char* key, char* out, int maxlen) {
    char search[64];
    snprintf(search, 64, "\"%s\":\"", key);
    const char* p = strstr(json, search);
    if (!p) { out[0] = '\0'; return; }
    p += strlen(search);
    int i = 0;
    while (*p && *p != '"' && i < maxlen - 1)
        out[i++] = *p++;
    out[i] = '\0';
}

/* ═══════════════════════════════════════════════════════════
 *  FILE SERVING
 * ═══════════════════════════════════════════════════════════ */
static char* read_file(const char* path, long* size) {
    FILE* f = fopen(path, "rb");
    if (!f) return NULL;
    fseek(f, 0, SEEK_END);
    *size = ftell(f);
    fseek(f, 0, SEEK_SET);
    char* data = (char*)malloc(*size + 1);
    if (!data) { fclose(f); return NULL; }
    fread(data, 1, *size, f);
    data[*size] = '\0';
    fclose(f);
    return data;
}

static const char* get_mime(const char* path) {
    const char* ext = strrchr(path, '.');
    if (!ext) return "text/plain";
    if (strcmp(ext, ".html") == 0) return "text/html";
    if (strcmp(ext, ".css") == 0) return "text/css";
    if (strcmp(ext, ".js") == 0) return "application/javascript";
    if (strcmp(ext, ".json") == 0) return "application/json";
    if (strcmp(ext, ".png") == 0) return "image/png";
    if (strcmp(ext, ".ico") == 0) return "image/x-icon";
    return "text/plain";
}

/* ═══════════════════════════════════════════════════════════
 *  HTTP SERVER
 * ═══════════════════════════════════════════════════════════ */
static void send_response(SOCKET client, int code, const char* status,
                           const char* content_type, const char* body, int body_len) {
    char header[512];
    int hlen = snprintf(header, 512,
        "HTTP/1.1 %d %s\r\n"
        "Content-Type: %s\r\n"
        "Content-Length: %d\r\n"
        "Access-Control-Allow-Origin: *\r\n"
        "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n"
        "Access-Control-Allow-Headers: Content-Type\r\n"
        "Connection: close\r\n"
        "\r\n",
        code, status, content_type, body_len);
    send(client, header, hlen, 0);
    if (body && body_len > 0)
        send(client, body, body_len, 0);
}

static void send_json(SOCKET client, const char* json) {
    send_response(client, 200, "OK", "application/json", json, (int)strlen(json));
}

static void send_ok(SOCKET client) {
    const char* resp = "{\"status\":\"ok\"}";
    send_json(client, resp);
}

static void handle_request(SOCKET client) {
    char buf[BUF_SIZE];
    int received = recv(client, buf, BUF_SIZE - 1, 0);
    if (received <= 0) return;
    buf[received] = '\0';

    /* Parse method and path */
    char method[8] = {0}, path[256] = {0};
    sscanf(buf, "%7s %255s", method, path);

    /* Find body (after double CRLF) */
    char* body = strstr(buf, "\r\n\r\n");
    if (body) body += 4;

    /* Handle OPTIONS (CORS preflight) */
    if (strcmp(method, "OPTIONS") == 0) {
        send_response(client, 200, "OK", "text/plain", "", 0);
        return;
    }

    /* ── API ROUTES ── */

    if (strcmp(method, "GET") == 0 && strcmp(path, "/state") == 0) {
        char* json = build_state_json();
        send_json(client, json);
        return;
    }

    if (strcmp(method, "POST") == 0 && strcmp(path, "/tick") == 0) {
        kernel_tick();
        char* json = build_state_json();
        send_json(client, json);
        return;
    }

    if (strcmp(method, "POST") == 0 && strcmp(path, "/create") == 0) {
        int pri = 0, burst = 0;
        if (body && strlen(body) > 2) {
            pri = json_get_int(body, "priority", 0);
            burst = json_get_int(body, "burst", 0);
        }
        if (pri <= 0) pri = (rand() % 5) + 1;
        if (burst <= 0) burst = (rand() % 12) + 4;
        kernel_create_process(pri, burst);
        char* json = build_state_json();
        send_json(client, json);
        return;
    }

    if (strcmp(method, "POST") == 0 && strcmp(path, "/batch") == 0) {
        for (int i = 0; i < 5; i++) {
            int pri = (rand() % 8) + 1;
            int burst = (rand() % 14) + 3;
            kernel_create_process(pri, burst);
        }
        char* json = build_state_json();
        send_json(client, json);
        return;
    }

    if (strcmp(method, "POST") == 0 && strcmp(path, "/reset") == 0) {
        kernel_reset();
        char* json = build_state_json();
        send_json(client, json);
        return;
    }

    if (strcmp(method, "POST") == 0 && strcmp(path, "/config") == 0) {
        if (body && strlen(body) > 2) {
            char algo[32] = {0};
            json_get_str(body, "algorithm", algo, 31);
            if (algo[0]) K.algorithm = parse_algo(algo);
            int q = json_get_int(body, "quantum", -1);
            if (q > 0) K.quantum = q;
        }
        char* json = build_state_json();
        send_json(client, json);
        return;
    }

    /* ── STATIC FILE SERVING ── */
    if (strcmp(method, "GET") == 0) {
        const char* file_path = path;
        char local_path[512];

        if (strcmp(path, "/") == 0) {
            file_path = "/index.html";
        }

        /* Build local file path - remove leading / */
        snprintf(local_path, 512, ".%s", file_path);

        /* Security: block path traversal */
        if (strstr(local_path, "..")) {
            send_response(client, 403, "Forbidden", "text/plain", "Forbidden", 9);
            return;
        }

        long fsize = 0;
        char* fdata = read_file(local_path, &fsize);
        if (fdata) {
            send_response(client, 200, "OK", get_mime(local_path), fdata, (int)fsize);
            free(fdata);
            return;
        }

        /* 404 */
        const char* msg404 = "<h1>404 Not Found</h1>";
        send_response(client, 404, "Not Found", "text/html", msg404, (int)strlen(msg404));
    }
}

/* ═══════════════════════════════════════════════════════════
 *  MAIN
 * ═══════════════════════════════════════════════════════════ */
int main(void) {
    WSADATA wsa;
    SOCKET server_sock, client_sock;
    struct sockaddr_in server_addr, client_addr;
    int client_len = sizeof(client_addr);

    printf("\n");
    printf("  ╔══════════════════════════════════════════════════════╗\n");
    printf("  ║   PROCESS LIFECYCLE VISUALIZATION TOOL              ║\n");
    printf("  ║   ─────────────────────────────────────────────     ║\n");
    printf("  ║   Backend Engine (C) + Frontend (HTML/CSS/JS)       ║\n");
    printf("  ║   Scheduling: FCFS | RR | SJF | SRTF | Priority    ║\n");
    printf("  ╚══════════════════════════════════════════════════════╝\n");
    printf("\n");

    /* Initialize Winsock */
    if (WSAStartup(MAKEWORD(2, 2), &wsa) != 0) {
        printf("  [ERROR] WSAStartup failed: %d\n", WSAGetLastError());
        return 1;
    }
    printf("  [OK] Winsock initialized\n");

    /* Initialize kernel */
    kernel_init();
    printf("  [OK] Kernel initialized (PID starts at %d)\n", K.nextPid);

    /* Create socket */
    server_sock = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (server_sock == INVALID_SOCKET) {
        printf("  [ERROR] Socket creation failed: %d\n", WSAGetLastError());
        WSACleanup();
        return 1;
    }

    /* Allow port reuse */
    int opt = 1;
    setsockopt(server_sock, SOL_SOCKET, SO_REUSEADDR, (const char*)&opt, sizeof(opt));

    /* Bind */
    server_addr.sin_family = AF_INET;
    server_addr.sin_addr.s_addr = INADDR_ANY;
    server_addr.sin_port = htons(PORT);

    if (bind(server_sock, (struct sockaddr*)&server_addr, sizeof(server_addr)) == SOCKET_ERROR) {
        printf("  [ERROR] Bind failed on port %d: %d\n", PORT, WSAGetLastError());
        printf("  [TIP]  Is another process using port %d?\n", PORT);
        closesocket(server_sock);
        WSACleanup();
        return 1;
    }

    /* Listen */
    if (listen(server_sock, SOMAXCONN) == SOCKET_ERROR) {
        printf("  [ERROR] Listen failed: %d\n", WSAGetLastError());
        closesocket(server_sock);
        WSACleanup();
        return 1;
    }

    printf("  [OK] Server listening on port %d\n", PORT);
    printf("\n");
    printf("  ┌──────────────────────────────────────────────────┐\n");
    printf("  │  Open browser:  http://localhost:%d             │\n", PORT);
    printf("  │  Press Ctrl+C to stop the server                │\n");
    printf("  └──────────────────────────────────────────────────┘\n");
    printf("\n");

    /* Accept loop */
    while (1) {
        client_sock = accept(server_sock, (struct sockaddr*)&client_addr, &client_len);
        if (client_sock == INVALID_SOCKET) continue;

        handle_request(client_sock);
        closesocket(client_sock);
    }

    closesocket(server_sock);
    WSACleanup();
    return 0;
}
