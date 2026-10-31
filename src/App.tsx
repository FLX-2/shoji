import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { MODELS } from "../runtime/src/models";
import { LimitAsk, type Ask } from "./budget/LimitAsk";
import { spentOn } from "./budget/daily";
import {
  bridge as tauriBridge,
  carrying,
  type Bridge,
  type Carried,
  type KeyStatus,
  type LedgerThread,
} from "./bridge";
import { folderName, type HomeDraft, HomeView } from "./home/HomeView";
import { startersIn } from "./home/starters";
import { baselineModel, modelLabel, oneModelCost, routingLine, threadSpend } from "./receipts/receipts";
import { Field } from "./look/Field";
import { lookStyle } from "./look/LookRows";
import { ReceiptsView } from "./receipts/ReceiptsView";
import { useSchedules } from "./schedule/useSchedules";
import { TEXT_SIZES, usePrefs } from "./settings/prefs";
import { readMcpServers, SETTINGS_PAGES, type SettingsPage, SettingsView } from "./settings/SettingsView";
import { SetupView } from "./setup/SetupView";
import { notesProgress, useNotes } from "./setup/useNotes";
import { useModelCatalog } from "./stack/catalog";
import { StackView } from "./stack/StackView";
import { estimateCost, tierOf, tierStack, TIERS, type Tier } from "./stack/tier";
import { keyLabel } from "./settings/shortcuts";
import { SEPARATOR, type MenuEntry } from "./shell/Menu";
import { useStack } from "./stack/useStack";
import { trialProgress, useTrial } from "./stack/useTrial";
import { Mark } from "./shell/Mark";
import { threadsMentioned, type SlashCommand } from "./shell/mention";
import { Rail } from "./shell/Rail";
import { WindowControls } from "./shell/WindowControls";
import { Search, type SearchItem } from "./shell/Search";
import { Toast, type Note } from "./shell/Toast";
import { threadMenu, type ThreadActions } from "./thread/actions";
import { liveTitle, threadTitle } from "./thread/title";
import { SECTIONS, type SectionId } from "./shell/sections";
import { foldRun, formatCost, reviewNotes } from "./thread/fold";
import { seenMark, useNotify, useWaitingBadge } from "./thread/notify";
import { DEFAULT_PREVIEW } from "./thread/PreviewView";
import { reopen, workThreads } from "./thread/reopen";
import { listOrder, threadState } from "./thread/ThreadList";
import { AgentsView } from "./agents/AgentsView";
import { ProjectList } from "./home/ProjectList";
import { projectsFrom } from "./home/projects";
import { ThreadList } from "./thread/ThreadList";
import { ThreadView } from "./thread/ThreadView";
import { isRunning, threadCost, useThreads } from "./thread/useThread";
import { guessCommand, useServers } from "./thread/useServers";
import { useTerminals } from "./thread/useTerminals";

/** Why a thread can't start in this folder yet, or null when it can. Each thread works in its own copy of the
 *  project, so changes the person hasn't committed are no reason to wait. */
async function folderProblem(bridge: Bridge, repo: string): Promise<string | null> {
  try {
    await bridge.projectFiles(repo);
    return null;
  } catch {
    return `${folderName(repo)} isn't a git repository. Shoji works in git so every change can be reviewed and undone.`;
  }
}

const isMac = typeof navigator !== "undefined" && /Mac/.test(navigator.userAgent);

function App({ bridge: given = tauriBridge }: { bridge?: Bridge }) {
  const [prefs, setPrefs] = usePrefs();
  // Shoji opens where the person left it: the same place, and the thread that was on show.
  const [section, setSection] = useState<SectionId>(() => prefs.place?.section ?? "home");
  const [settingsPage, setSettingsPage] = useState<SettingsPage>("look");
  const catalog = useModelCatalog(prefs.updateModels);
  // The models there at first are known ones; only a model the list brings later is new.
  useEffect(() => {
    if (!prefs.seenModels) setPrefs({ seenModels: Object.keys(MODELS) });
  }, [prefs.seenModels, setPrefs]);
  // The project's files, for @ in the task box, read again when the project changes. Threads work in their
  // own copies, so the project itself only changes in the person's hands.
  const [projectFiles, setProjectFiles] = useState<string[]>([]);
  // A project's dev server: the command the person gave, or a guess for the open project.
  const devCommandIn = (repo: string) =>
    prefs.devCommands[repo] ?? (repo === prefs.repo ? guessCommand(projectFiles) : "");
  // Every run, trial and notes run carries the private files and the model list as they are when it starts.
  const carried = useRef<Carried>({ privateFiles: prefs.privateFiles });
  carried.current = {
    privateFiles: prefs.privateFiles,
    models: catalog ?? undefined,
    mcpServers: readMcpServers(prefs.mcpServers).servers,
    ...(prefs.lookAtPages && { devCommandFor: devCommandIn }),
  };
  const bridge = useMemo(() => carrying(given, () => carried.current), [given]);
  const [keyStatus, setKeyStatus] = useState<KeyStatus | null>(null);
  const stack = useStack(bridge, prefs.stack);
  // Read through a ref, so a command allowed mid-thread counts for the thread's next run.
  const allowed = useRef(prefs.allowedCommands);
  allowed.current = prefs.allowedCommands;
  const allowedIn = useCallback((repo: string) => allowed.current[repo] ?? [], []);
  const {
    thread,
    threads,
    start,
    requestChanges,
    keepGoing,
    fix,
    resume,
    build,
    replan,
    question,
    stop,
    answer,
    commit,
    open,
    showId,
    patch,
    close,
    elsewhere,
  } = useThreads(bridge, allowedIn);
  const servers = useServers(bridge);
  const terminals = useTerminals(bridge);
  const trials = useTrial(bridge);
  const trialRunning = !!trials.trial && trialProgress(trials.trial).running;
  const notes = useNotes(bridge);
  const notesRunning = !!notes.notes && notesProgress(notes.notes).running;
  // Scout's notes end with a few first tasks, offered on Home until the first thread.
  const notesResult = notes.notes && notesProgress(notes.notes).result;
  useEffect(() => {
    if (!notes.notes || notesResult?.status !== "ready") return;
    const repo = notes.notes.repo;
    const starters = startersIn(notesResult.notes);
    if (starters.length) setPrefs((now) => ({ starters: { ...now.starters, [repo]: starters } }));
  }, [notesResult]);
  const threadRunning = isRunning(thread?.turns.at(-1));
  const live = threads.filter((t) => isRunning(t.turns.at(-1)));
  const running = live.length > 0 || trialRunning || notesRunning;
  const current = SECTIONS[section];

  // Setup opens on its own at launch when there's no saved key and it was never finished. It stays
  // open until it's finished, even once the key is saved along the way.
  const [inSetup, setInSetup] = useState(false);
  const refreshKey = useCallback(() => bridge.keyStatus().then(setKeyStatus), [bridge]);
  useEffect(() => {
    bridge.keyStatus().then(
      (status) => {
        setKeyStatus(status);
        if (!status.saved && !prefs.setupDone) setInSetup(true);
      },
      () => setKeyStatus({ saved: false, fromEnv: false }),
    );
    // Only at launch: forgetting the key later in Settings shouldn't pull the person into setup.
  }, [bridge]);

  // Changes whenever a thread gets its ledger id, starts or ends a run, is committed, or a running thread or trial
  // pays for a call, so today's spend keeps up with the work.
  const activity = [
    ...threads.map((t) => {
      const running = isRunning(t.turns.at(-1));
      return `${t.id}:${t.turns.length}:${running}:${t.committed}:${running ? threadCost(t) : ""}`;
    }),
    trials.trial && trialRunning ? trialProgress(trials.trial).spent : "",
  ].join();
  // The ledger, read again whenever a run starts or ends: the thread list, today's spend for the daily limit,
  // recent tasks for Home's estimate, and Stack's Watching row.
  const [ledger, setLedger] = useState<LedgerThread[]>([]);
  // Moves on whenever the person renames, pins, archives or discards a thread, so the ledger is read again.
  const [ledgerTick, setLedgerTick] = useState(0);
  const reread = () => setLedgerTick((n) => n + 1);
  // Set once the ledger has been read, so the first read can count every thread as seen.
  const [ledgerRead, setLedgerRead] = useState(false);
  useEffect(() => {
    bridge
      .ledgerThreads()
      .then((all) => {
        setLedger(all);
        setLedgerRead(true);
      })
      .catch(() => setLedger([]));
    // Read again on a commit or on opening Threads too, so each thread shows where it got to.
  }, [bridge, activity, trialRunning, notesRunning, section, ledgerTick]);
  const pastThreads = useMemo(() => workThreads(ledger), [ledger]);
  // Threads the person hasn't put away: what Home, Agents and the projects count.
  const keptThreads = useMemo(() => pastThreads.filter((t) => !t.archivedAt), [pastThreads]);
  const liveIdsKey = live.map((t) => t.id).join();
  const liveIds = useMemo(() => new Set(live.flatMap((t) => (t.id === undefined ? [] : [t.id]))), [liveIdsKey]);

  // The thread the person is looking at, which has no news for them and needs no notification.
  const viewing = section === "threads" ? thread?.id : undefined;
  useNotify(bridge, threads, viewing, prefs.notify);
  // A thread whose runs moved on since the person last looked at it is marked unread in the list. At the first
  // read of the ledger every thread counts as seen, so only what happens from then on is news.
  useEffect(() => {
    if (!ledgerRead) return;
    if (!prefs.seen) {
      setPrefs({ seen: Object.fromEntries(pastThreads.map((t) => [t.id, seenMark(t)])) });
      return;
    }
    const shown = pastThreads.find((t) => t.id === viewing);
    if (shown && prefs.seen[shown.id] !== seenMark(shown)) {
      setPrefs((now) => ({ seen: { ...now.seen, [shown.id]: seenMark(shown) } }));
    }
  }, [ledgerRead, pastThreads, viewing, prefs.seen]);
  const unread = useMemo(
    () =>
      new Set(
        keptThreads
          .filter((t) => prefs.seen && !(t.id in prefs.seen && prefs.seen[t.id] === seenMark(t)))
          .filter((t) => t.id !== viewing && !liveIds.has(t.id) && !t.discardedAt)
          .map((t) => t.id),
      ),
    [keptThreads, prefs.seen, viewing, liveIds],
  );
  // The icon counts what waits for the person: unread threads that need them, and running ones asking to run a
  // command.
  const asking = live.filter((t) => foldRun(t.turns.at(-1)!.events).asking !== undefined).length;
  const waiting = prefs.notify
    ? asking + keptThreads.filter((t) => unread.has(t.id) && threadState(t, liveIds).group === "Needs you").length
    : 0;
  useWaitingBadge(bridge, waiting);
  // And the project's commands, for / at the start of a task.
  const [projectCommands, setProjectCommands] = useState<SlashCommand[]>([]);
  useEffect(() => {
    setProjectFiles([]);
    setProjectCommands([]);
    if (!prefs.repo) return;
    let current = true;
    bridge.projectFiles(prefs.repo).then(
      (files) => current && setProjectFiles(files),
      () => {},
    );
    bridge.projectCommands(prefs.repo).then(
      (commands) => current && setProjectCommands(commands),
      () => {},
    );
    return () => {
      current = false;
    };
  }, [bridge, prefs.repo, section]);

  const spentToday = useMemo(() => spentOn(ledger, new Date()), [ledger]);
  const [tier, setTier] = useState<Tier>("balanced");
  const estimate = useMemo(
    () => (prefs.showCosts ? estimateCost(ledger, tierStack(stack.stack, tier)) : null),
    [ledger, stack.stack, tier, prefs.showCosts],
  );

  // A thread's whole limit counts against the day when it starts, so its later changes stay inside what
  // was allowed then. Past the daily limit, Shoji asks first.
  const [ask, setAsk] = useState<Ask | null>(null);
  const withinDay = (what: string, cap: number, go: () => void): boolean => {
    if (spentToday + cap <= prefs.dailyLimit) {
      go();
      return true;
    }
    setAsk({ spent: spentToday, cap, what, go });
    return false;
  };

  const hasKey = !!keyStatus && (keyStatus.saved || keyStatus.fromEnv);
  // Scheduled tasks start by themselves, never past the daily limit, since nobody may be here to say yes.
  useSchedules(
    prefs.schedules,
    (schedules) => setPrefs({ schedules }),
    (schedule) => {
      if (!hasKey) return "there was no API key";
      if (spentToday + prefs.cap > prefs.dailyLimit)
        return `it could have taken the day past your ${formatCost(prefs.dailyLimit)} limit`;
      start(schedule.task, schedule.repo, tierStack(stack.stack, schedule.tier), prefs.cap, false, [], true);
      return null;
    },
  );

  // The queue: once nothing runs, the first task in line starts, unless it would take the day past its limit,
  // when it waits and says so.
  const idle = live.length === 0 && !trialRunning && !notesRunning;
  useEffect(() => {
    const next = prefs.queue[0];
    if (!idle || !next || !hasKey || !ledgerRead) return;
    if (spentToday + prefs.cap > prefs.dailyLimit) {
      const held = `Waiting: it could take today past your ${formatCost(prefs.dailyLimit)} limit`;
      if (next.held !== held) setPrefs((now) => ({ queue: now.queue.map((q, i) => (i ? q : { ...q, held })) }));
      return;
    }
    setPrefs((now) => ({ queue: now.queue.filter((q) => q.id !== next.id) }));
    start(next.task, next.repo, tierStack(stack.stack, next.tier), prefs.cap, false, [], true);
  }, [idle, prefs.queue, hasKey, ledgerRead, spentToday]);

  const [startProblem, setStartProblem] = useState<string | null>(null);
  // A task brought back to Home to edit, or a new one carrying on a committed thread. `n` makes Home take it afresh.
  const [homeDraft, setHomeDraft] = useState<(HomeDraft & { n: number }) | null>(null);
  const bringHome = (repo: string, draft: HomeDraft) => {
    setPrefs({ repo });
    setStartProblem(null);
    setHomeDraft((now) => ({ ...draft, n: (now?.n ?? 0) + 1 }));
    setSection("home");
  };
  // A past thread being read back from the ledger, shown at once by its title while its runs load.
  const [opening, setOpening] = useState<LedgerThread | null>(null);
  const openRecord = async (record: LedgerThread, stay = false) => {
    if (!stay) setSection("threads");
    if (showId(record.id)) return;
    setOpening(record);
    try {
      open(await reopen(bridge, record, prefs.cap));
    } finally {
      setOpening((now) => (now?.id === record.id ? null : now));
    }
  };
  // Builds a plan from Agents. A thread from before Shoji opened is read back first, then built.
  const [toBuild, setToBuild] = useState<number | null>(null);
  useEffect(() => {
    if (toBuild === null || !elsewhere.holds(toBuild)) return;
    elsewhere.build(toBuild);
    setToBuild(null);
  }, [toBuild, elsewhere]);
  const buildFrom = async (record: LedgerThread) => {
    if (elsewhere.holds(record.id)) return elsewhere.build(record.id);
    setToBuild(record.id);
    open(await reopen(bridge, record, prefs.cap));
  };

  // Receipts opened on one thread's receipt, from the thread.
  const [receiptFor, setReceiptFor] = useState<number | null>(null);
  const viewReceipt = (id: number) => {
    setReceiptFor(id);
    setSection("receipts");
  };
  useEffect(() => {
    if (section !== "receipts") setReceiptFor(null);
  }, [section]);

  // The box for a new task, in Threads with no thread on show.
  const newTask = () => {
    close();
    setSection("threads");
  };
  const restored = useRef(false);
  useEffect(() => {
    if (!ledgerRead || restored.current) return;
    restored.current = true;
    const left = keptThreads.find((t) => t.id === prefs.place?.thread);
    if (left) openRecord(left, true).catch(() => {});
  }, [ledgerRead]);
  useEffect(() => {
    if (restored.current) setPrefs({ place: { section, ...(thread?.id !== undefined && { thread: thread.id }) } });
  }, [section, thread?.id, ledgerRead]);
  // A project removed from the list stays away until it's open or a thread starts in it again.
  const projects = useMemo(
    () =>
      projectsFrom(keptThreads, liveIds, prefs.repo).filter(
        (p) => p.repo === prefs.repo || !(p.last <= (prefs.hiddenProjects[p.repo] ?? -1)),
      ),
    [keptThreads, liveIdsKey, prefs.repo, prefs.hiddenProjects],
  );
  const openProject = (repo: string) => {
    setPrefs({ repo });
    setStartProblem(null);
  };
  const projectMenu = (repo: string): MenuEntry[] => [
    { label: "Open folder", run: () => bridge.revealFolder(repo).catch(failed) },
    {
      label: "Remove from list",
      disabled: repo === prefs.repo,
      run: () => {
        setPrefs((now) => ({ hiddenProjects: { ...now.hiddenProjects, [repo]: Date.now() } }));
        setNote({
          text: `Removed ${folderName(repo)} from the list. Its threads stay.`,
          undo: () =>
            setPrefs((now) => {
              const { [repo]: _, ...rest } = now.hiddenProjects;
              return { hiddenProjects: rest };
            }),
        });
      },
    },
  ];
  const recent = useMemo(
    () =>
      keptThreads
        .filter((t) => t.repo === prefs.repo)
        .map((thread) => ({ thread, ...threadState(thread, liveIds) }))
        .filter((t) => t.group !== "Earlier"),
    [keptThreads, liveIdsKey, prefs.repo],
  );

  // A short note after an action, with Undo when it can be undone.
  const [note, setNote] = useState<Note | null>(null);
  const closeNote = useCallback(() => setNote(null), []);
  const failed = (error: unknown) => setNote({ text: String(error).replace(/^Error: /, ""), problem: true });
  // The thread whose name is being edited, in the list or the title bar.
  const [renaming, setRenaming] = useState<number | null>(null);
  const actions: ThreadActions = {
    rename: (t) => setRenaming(t.id),
    receipt: (t) => viewReceipt(t.id),
    pin: (t, pinned) => bridge.pinThread(t.id, pinned).then(reread, failed),
    archive: (t, archived) =>
      bridge.archiveThread(t.id, archived).then(() => {
        reread();
        if (!archived) return setNote({ text: `Brought back "${threadTitle(t)}"` });
        if (thread?.id === t.id) close();
        setNote({
          text: `Archived "${threadTitle(t)}"`,
          undo: () => bridge.archiveThread(t.id, false).then(reread, failed),
        });
      }, failed),
    discard: (t) =>
      bridge.discardThread(t.id).then(() => {
        reread();
        patch(t.id, { discarded: true, workdir: undefined });
        if (thread?.id === t.id) close();
        setNote({ text: `Discarded the work of "${threadTitle(t)}"` });
      }, failed),
    reveal: (t) =>
      bridge.revealFolder(t.workdir && !t.committed && !t.discardedAt ? t.workdir : t.repo).catch(failed),
    copyBranch: (t) =>
      navigator.clipboard.writeText(t.branch).then(() => setNote({ text: `Copied ${t.branch}` }), failed),
  };
  const menuFor = (t: LedgerThread) => threadMenu(t, actions, liveIds.has(t.id));
  const renamed = (t: LedgerThread, title: string | null) => {
    setRenaming(null);
    if (title === null) return;
    patch(t.id, { title });
    bridge.renameThread(t.id, title).then(reread, failed);
  };

  // Search, from the title bar or Ctrl+K (⌘K on a Mac), anywhere in the app.
  const [searching, setSearching] = useState(false);
  // The app's own keys, read afresh on each press, since what they do depends on what's on show.
  const onKey = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    const listen = (e: KeyboardEvent) => onKey.current(e);
    window.addEventListener("keydown", listen);
    return () => window.removeEventListener("keydown", listen);
  }, []);
  const searchItems = (): SearchItem[] => [
    ...actionItems(),
    ...pastThreads.map((t) => ({
      id: `thread-${t.id}`,
      group: "Threads",
      label: threadTitle(t),
      detail: `${t.archivedAt ? "Archived" : threadState(t, liveIds).status} · ${folderName(t.repo)}`,
      run: () => openRecord(t),
    })),
    ...projects.map((p) => ({
      id: `project-${p.repo}`,
      group: "Projects",
      label: folderName(p.repo),
      detail: p.repo,
      run: () => {
        setPrefs({ repo: p.repo });
        setStartProblem(null);
        setSection("home");
      },
    })),
    ...(Object.keys(SECTIONS) as SectionId[]).map((id) => ({
      id: `section-${id}`,
      group: "Go to",
      label: SECTIONS[id].label,
      run: () => setSection(id),
    })),
    ...SETTINGS_PAGES.map((page) => ({
      id: `settings-${page.id}`,
      group: "Settings",
      label: page.label,
      detail: `Settings · ${page.group}`,
      run: () => {
        setSettingsPage(page.id);
        setSection("settings");
      },
    })),
  ];

  const agents = useMemo(
    () =>
      keptThreads
        .map((record) => ({ record, ...threadState(record, liveIds) }))
        .filter((a) => a.group !== "Earlier")
        .sort((a, b) => (a.group === b.group ? 0 : a.group === "Running" ? -1 : 1))
        .map(({ record, status }) => ({ record, status, live: threads.find((t) => t.id === record.id) })),
    [keptThreads, liveIdsKey, threads],
  );

  // The thread on show as the ledger has it, for its actions.
  const shownRecord = thread?.id === undefined ? undefined : pastThreads.find((t) => t.id === thread.id);

  const pickProject = async () => {
    const repo = await bridge.pickProject();
    if (repo) {
      setPrefs({ repo });
      setStartProblem(null);
    }
  };

  // The project the status bar names: the thread's, while one is on show in Threads.
  const place = section === "threads" && thread ? thread.repo : prefs.repo;

  // Earlier threads a new task can name with @, and what they planned and heard back, for the task's context.
  const mentionable = useMemo(() => keptThreads.map((t) => ({ id: t.id, title: threadTitle(t) })), [keptThreads]);
  const mentionedContext = async (task: string) => {
    const named = threadsMentioned(task);
    const found = keptThreads.filter((t) => named.includes(threadTitle(t)));
    const parts: string[] = [];
    for (const t of found) {
      const run = t.runs.at(-1);
      if (!run) continue;
      const result = foldRun(await bridge.runEvents(run.id).catch(() => [])).result;
      if (!result) continue;
      const said = [
        result.plan && `Its plan:\n${result.plan}`,
        reviewNotes(result.review) && `Its review said:\n${reviewNotes(result.review)}`,
      ].filter(Boolean);
      if (said.length) parts.push(`From “${threadTitle(t)}”:\n\n${said.join("\n\n")}`);
    }
    return parts.length ? `The task names earlier threads. What they planned and what their reviews said:\n\n${parts.join("\n\n")}` : undefined;
  };

  // The box a new task is written in, on Home and in Threads when no thread is on show.
  const taskProps: ComponentProps<typeof HomeView> = {
    draft: homeDraft,
    repo: prefs.repo,
    hasKey,
    onPickProject: pickProject,
    projects: projects.map((p) => p.repo),
    starters: (prefs.repo && prefs.starters[prefs.repo]) || [],
    onChooseProject: openProject,
    onOpenSettings: () => {
      setSettingsPage("models");
      setSection("settings");
    },
    problem: startProblem,
    planFirst: prefs.planFirst,
    onTogglePlanFirst: () => setPrefs({ planFirst: !prefs.planFirst }),
    tier,
    onTier: setTier,
    estimate,
    onPickAttachments: () => bridge.pickAttachments(),
    onSavePasted: async (image) =>
      bridge.saveAttachment(image.name || "pasted.png", Array.from(new Uint8Array(await image.arrayBuffer()))),
    files: projectFiles,
    commands: projectCommands,
    threads: mentionable,
    showCosts: prefs.showCosts,
    onQueue: (task) => {
      if (!prefs.repo) return;
      setPrefs({ queue: [...prefs.queue, { id: crypto.randomUUID(), task, repo: prefs.repo, tier }] });
      setSection("threads");
    },
    onSchedule: (task, when) => {
      if (!prefs.repo) return;
      const schedule = { id: crypto.randomUUID(), task, repo: prefs.repo, tier, created: Date.now(), ...when };
      setPrefs({ schedules: [...prefs.schedules, schedule] });
      setSection("threads");
    },
    onStart: async (task, attachments, from) => {
      const repo = prefs.repo;
      if (!repo) return false;
      // Checked here so the task stays in the composer while the person sorts the folder out.
      const problem = await folderProblem(bridge, repo);
      setStartProblem(problem);
      if (problem) return false;
      const context = await mentionedContext(task);
      return withinDay("This thread", prefs.cap, () => {
        setSection("threads");
        setHomeDraft(null);
        start(task, repo, tierStack(stack.stack, tier), prefs.cap, prefs.planFirst, attachments, false, from, context);
      });
    },
  };

  useEffect(() => {
    bridge.setZoom(prefs.textSize).catch(() => {});
  }, [bridge, prefs.textSize]);

  // The threads in the list's order, for stepping through them from the keyboard.
  const filtered = prefs.listProject && pastThreads.some((t) => t.repo === prefs.listProject);
  const order = listOrder(filtered ? pastThreads.filter((t) => t.repo === prefs.listProject) : pastThreads, liveIds);
  const askingIds = new Set(live.filter((t) => foldRun(t.turns.at(-1)!.events).asking !== undefined).map((t) => t.id));
  const stepThreads = (by: number, only?: (t: LedgerThread) => boolean) => {
    const pool = only ? order.filter((t) => only(t) || t.id === thread?.id) : order;
    const at = pool.findIndex((t) => t.id === thread?.id);
    const next = at < 0 ? (by > 0 ? pool[0] : pool.at(-1)) : pool[(at + by + pool.length) % pool.length];
    if (next && next.id !== thread?.id) openRecord(next).catch(failed);
  };
  const nextNeedingYou = () =>
    stepThreads(1, (t) => askingIds.has(t.id) || threadState(t, liveIds).group === "Needs you");
  const resize = (by: number) =>
    setPrefs((now) => {
      const known = TEXT_SIZES.indexOf(now.textSize);
      const at = known < 0 ? TEXT_SIZES.indexOf(1) : known;
      return { textSize: TEXT_SIZES[Math.min(Math.max(at + by, 0), TEXT_SIZES.length - 1)] };
    });
  const canBuild =
    !!thread &&
    !threadRunning &&
    !thread.committed &&
    foldRun(thread.turns.at(-1)?.events ?? []).result?.status === "planned";
  const openShortcuts = () => {
    setSettingsPage("shortcuts");
    setSection("settings");
  };

  onKey.current = (e) => {
    const mod = isMac ? e.metaKey : e.ctrlKey;
    if (mod && !e.altKey && ["=", "+", "-", "0"].includes(e.key)) {
      e.preventDefault();
      if (e.key === "0") setPrefs({ textSize: 1 });
      else resize(e.key === "-" ? -1 : 1);
      return;
    }
    if (inSetup) return;
    if (e.key === "Tab" && e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      stepThreads(e.shiftKey ? -1 : 1);
      return;
    }
    if (e.key === "Escape") {
      // Esc stops the thread on show, unless it's closing something else or there's writing in the box.
      const field = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      const busy = document.querySelector('[role="dialog"], [role="menu"]');
      if (e.defaultPrevented || busy || (field && (e.target as HTMLInputElement).value !== "")) return;
      if (section === "threads" && threadRunning) {
        e.preventDefault();
        stop();
      }
      return;
    }
    if (!mod || e.altKey) return;
    const key = e.key.toLowerCase();
    if (e.shiftKey) {
      if (key === "a") {
        e.preventDefault();
        nextNeedingYou();
      }
      return;
    }
    const keys: Record<string, () => void> = {
      k: () => setSearching((open) => !open),
      // Hides the thread list, or shows it again, for more room for the thread.
      b: () => setPrefs((now) => ({ listHidden: !now.listHidden })),
      n: newTask,
      ",": () => setSection("settings"),
      "/": openShortcuts,
    };
    if (!keys[key]) return;
    e.preventDefault();
    setSearching(false);
    keys[key]();
  };

  // What ⌘K can do, besides finding: the actions on show elsewhere, the likeliest first, with their keys.
  const actionItems = (): SearchItem[] => {
    const act = (id: string, label: string, run: () => void, keys?: string[], detail?: string): SearchItem => ({
      id: `act-${id}`,
      group: "Actions",
      label,
      run,
      ...(keys && { keys: keys.map((k) => keyLabel(k, isMac)) }),
      ...(detail && { detail }),
    });
    const onShow = section === "threads" && thread ? liveTitle(thread) : undefined;
    const threadActions =
      onShow && shownRecord
        ? menuFor(shownRecord).flatMap((item, i) =>
            item === SEPARATOR || item.confirm || item.disabled
              ? []
              : [act(`thread-${i}`, item.label, item.run, item.hint ? [item.hint] : undefined, onShow)],
          )
        : [];
    return [
      ...(onShow && threadRunning ? [act("stop", "Stop this thread", stop, ["Esc"], onShow)] : []),
      ...(onShow && canBuild ? [act("build", "Build the plan", build, undefined, onShow)] : []),
      act("new", "New task", newTask, ["mod", "N"]),
      act("next", "Next thread that needs you", nextNeedingYou, ["mod", "Shift", "A"]),
      ...threadActions,
      act("list", prefs.listHidden ? "Show the thread list" : "Hide the thread list", () =>
        setPrefs({ listHidden: !prefs.listHidden }), ["mod", "B"]),
      act(
        "plan",
        prefs.planFirst ? "Stop checking the plan first" : "Check the plan first",
        () => setPrefs({ planFirst: !prefs.planFirst }),
        undefined,
        "For new tasks",
      ),
      ...(Object.keys(TIERS) as Tier[])
        .filter((id) => id !== tier)
        .map((id) => act(`tier-${id}`, `Quality: ${TIERS[id].label}`, () => setTier(id), undefined, "For the next task")),
      act("bigger", "Larger text", () => resize(1), ["mod", "+"]),
      act("smaller", "Smaller text", () => resize(-1), ["mod", "-"]),
      act("shortcuts", "Keyboard shortcuts", openShortcuts, ["mod", "/"]),
    ];
  };

  return (
    <div
      className="app"
      data-state={running ? "running" : "idle"}
      data-platform={isMac ? "mac" : "other"}
      data-motion={prefs.motion ? "on" : "off"}
      data-opaque={prefs.opaque || undefined}
      data-density={prefs.density}
      data-models={prefs.showModels ? undefined : "hidden"}
      data-status={prefs.statusBar ? undefined : "hidden"}
      style={lookStyle(prefs)}
    >
      {!prefs.opaque && prefs.field !== "none" && (
        <Field key={prefs.field} id={prefs.field} running={running} still={!prefs.motion} />
      )}
      <header className="titlebar solid" data-tauri-drag-region>
        <div data-tauri-drag-region />
        <div className="center" data-tauri-drag-region>
          <span className="lockup" data-tauri-drag-region>
            <Mark />
            shoji
          </span>
        </div>
        <div className="right" data-tauri-drag-region>
          {!inSetup && (
            <button
              type="button"
              className="find"
              title={`Search (${isMac ? "⌘K" : "Ctrl+K"})`}
              onClick={() => setSearching(true)}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <circle cx="7" cy="7" r="4.25" />
                <path d="m10.25 10.25 3 3" />
              </svg>
              Search
              <kbd>{isMac ? "⌘K" : "Ctrl K"}</kbd>
            </button>
          )}
          <span className="runlight" role="status">
            <span className="dot live" aria-hidden="true" />
            {running ? "running" : "idle"}
          </span>
          {!isMac && <WindowControls />}
        </div>
      </header>

      {inSetup ? (
        <div className="body">
          <SetupView
            bridge={bridge}
            keyStatus={keyStatus}
            onKeyChanged={refreshKey}
            stack={stack.stack}
            onSaveStack={stack.save}
            prefs={prefs}
            onChange={setPrefs}
            notes={notes.notes}
            onWriteNotes={(repo) => notes.start(repo, stack.stack)}
            onDone={() => {
              setPrefs({ setupDone: true });
              setInSetup(false);
              setSection("home");
            }}
          />
        </div>
      ) : (
        <div className="body">
          <Rail current={section} onSelect={setSection} />
          <main className="main">
            {section === "home" ? (
              <div className={projects.length > 1 ? "split" : "solo"}>
                {projects.length > 1 && (
                  <ProjectList
                    menuFor={projectMenu}
                    projects={projects}
                    open={prefs.repo}
                    onOpen={(repo) => {
                      setPrefs({ repo });
                      setStartProblem(null);
                    }}
                    onAdd={pickProject}
                  />
                )}
                <HomeView
                  {...taskProps}
                  key={homeDraft?.n ?? 0}
                  recent={recent}
                  firstRun={pastThreads.length === 0 && threads.length === 0}
                  onOpenThread={openRecord}
                  onOpenAgents={() => setSection("agents")}
                />
              </div>
            ) : section === "receipts" ? (
              <ReceiptsView
                key={receiptFor ?? "all"}
                bridge={bridge}
                onNew={newTask}
                {...(receiptFor !== null && { open: receiptFor })}
              />
            ) : section === "stack" ? (
              <StackView
                bridge={bridge}
                repo={prefs.repo}
                trial={trials.trial}
                onStartTrial={(request) => withinDay("This trial", request.cap, () => trials.start(request))}
                onStopTrial={trials.stop}
                stack={stack.stack}
                lock={stack.lock}
                error={stack.error}
                onSave={stack.save}
                ledger={ledger}
                seenModels={prefs.seenModels ?? Object.keys(MODELS)}
                onSeeModels={(models) =>
                  setPrefs({ seenModels: [...new Set([...(prefs.seenModels ?? Object.keys(MODELS)), ...models])] })
                }
              />
            ) : section === "threads" ? (
              <div className="threads">
                {(pastThreads.length > 0 || prefs.schedules.length > 0 || prefs.queue.length > 0) &&
                  !prefs.listHidden && (
                  <ThreadList
                    schedules={prefs.schedules}
                    queue={prefs.queue}
                    onUnqueue={(id) => setPrefs({ queue: prefs.queue.filter((q) => q.id !== id) })}
                    onPause={(id) =>
                      setPrefs({
                        // Times missed while paused stay missed.
                        schedules: prefs.schedules.map((s) =>
                          s.id === id ? { ...s, paused: !s.paused, ...(s.paused && { last: Date.now() }) } : s,
                        ),
                      })
                    }
                    onRemove={(id) => {
                      const at = prefs.schedules.findIndex((s) => s.id === id);
                      const gone = prefs.schedules[at];
                      if (!gone) return;
                      setPrefs({ schedules: prefs.schedules.filter((s) => s.id !== id) });
                      setNote({
                        text: `Removed "${gone.task.split("\n")[0]}" from the schedule`,
                        undo: () =>
                          setPrefs((now) => ({
                            schedules: [...now.schedules.slice(0, at), gone, ...now.schedules.slice(at)],
                          })),
                      });
                    }}
                    threads={pastThreads}
                    running={liveIds}
                    unread={unread}
                    current={opening?.id ?? thread?.id}
                    showCosts={prefs.showCosts}
                    onOpen={openRecord}
                    onNew={newTask}
                    menuFor={menuFor}
                    renaming={renaming}
                    onStartRename={actions.rename}
                    onRenamed={renamed}
                    project={prefs.listProject ?? null}
                    onProject={(repo) => setPrefs({ listProject: repo })}
                    folded={prefs.foldedGroups}
                    onFold={(group) =>
                      setPrefs((now) => ({
                        foldedGroups: now.foldedGroups.includes(group)
                          ? now.foldedGroups.filter((g) => g !== group)
                          : [...now.foldedGroups, group],
                      }))
                    }
                  />
                )}
                {opening ? (
                  <section className="thread" aria-busy="true">
                    <div className="convo">
                      <div className="tbar solid">
                        <h1>{threadTitle(opening)}</h1>
                      </div>
                      <div className="skel" aria-label="Reading the thread back">
                        <i />
                        <i />
                        <i />
                      </div>
                    </div>
                  </section>
                ) : thread ? (
                  <ThreadView
                    key={thread.id ?? "new"}
                    bridge={bridge}
                    thread={thread}
                    onStop={stop}
                    onRequestChanges={requestChanges}
                    onKeepGoing={() => withinDay("Keeping this thread going", prefs.cap, () => keepGoing(prefs.cap))}
                    onFix={() => withinDay("Fixing what the review found", prefs.cap, () => fix(prefs.cap))}
                    more={prefs.cap}
                    onRetry={() =>
                      withinDay("This thread", thread.cap, () => {
                        const first = thread.id;
                        start(thread.task, thread.repo, thread.stack, thread.cap, prefs.planFirst, thread.attachments);
                        // The first try ended before it had a plan, so it holds no work: its copy goes, and the
                        // thread is put away, its costs kept for Receipts.
                        if (first !== undefined) bridge.discardThread(first).then(reread, () => {});
                      })
                    }
                    onEditTask={() =>
                      bringHome(thread.repo, { task: thread.task, attachments: thread.attachments ?? [] })
                    }
                    onResume={resume}
                    onContinue={() =>
                      bringHome(thread.repo, {
                        task: "",
                        attachments: [],
                        ...(thread.branch && { from: { branch: thread.branch, title: liveTitle(thread) } }),
                      })
                    }
                    onBuild={build}
                    tier={tierOf(thread.stack, stack.stack)}
                    {...(shownRecord && {
                      routing: {
                        line: routingLine(shownRecord),
                        spent: threadSpend(shownRecord),
                        oneModel: oneModelCost(shownRecord),
                        baseline: modelLabel(baselineModel(shownRecord)).split(" ")[0],
                      },
                      onViewReceipt: () => viewReceipt(shownRecord.id),
                    })}
                    onTier={(t) => thread.id !== undefined && patch(thread.id, { stack: tierStack(stack.stack, t) })}
                    onReplan={replan}
                    onQuestion={question}
                    onCommit={commit}
                    onPush={() => bridge.pushThread(thread.repo, thread.branch!)}
                    onAnswer={(command, allow, always) => {
                      if (always) {
                        const now = prefs.allowedCommands[thread.repo] ?? [];
                        setPrefs({ allowedCommands: { ...prefs.allowedCommands, [thread.repo]: [...now, command] } });
                      }
                      return answer(allow);
                    }}
                    showCosts={prefs.showCosts}
                    previewUrl={prefs.previewUrls[thread.repo] ?? DEFAULT_PREVIEW}
                    onPreviewUrl={(url) => setPrefs({ previewUrls: { ...prefs.previewUrls, [thread.repo]: url } })}
                    server={servers.servers[thread.committed || !thread.workdir ? thread.repo : thread.workdir]}
                    devCommand={devCommandIn(thread.repo)}
                    onStartServer={(dir, command) => {
                      setPrefs({ devCommands: { ...prefs.devCommands, [thread.repo]: command } });
                      servers.start(dir, command);
                    }}
                    onStopServer={servers.stop}
                    terminals={terminals}
                    still={!prefs.motion}
                    autoPanel={prefs.autoPanel}
                    {...(shownRecord && {
                      menu: menuFor(shownRecord),
                      renaming: renaming === shownRecord.id,
                      onStartRename: () => setRenaming(shownRecord.id),
                      onRenamed: (title: string | null) => renamed(shownRecord, title),
                    })}
                  />
                ) : (
                  <HomeView
                    {...taskProps}
                    key={homeDraft?.n ?? 0}
                    heading="New thread"
                    firstRun={pastThreads.length === 0 && threads.length === 0}
                  />
                )}
              </div>
            ) : section === "agents" ? (
              <AgentsView
                agents={agents}
                showCosts={prefs.showCosts}
                onOpen={openRecord}
                onNew={newTask}
                onStop={(r) => elsewhere.stop(r.id)}
                onAnswer={(r, allow) => elsewhere.answer(r.id, allow)}
                onBuild={buildFrom}
              />
            ) : section === "settings" ? (
              <SettingsView
                page={settingsPage}
                onPage={setSettingsPage}
                prefs={prefs}
                onChange={setPrefs}
                stack={stack.stack}
                onOpenStack={() => setSection("stack")}
                keyStatus={keyStatus}
                onSaveKey={(key) => bridge.saveKey(key).then(refreshKey)}
                onForgetKey={() => bridge.forgetKey().then(refreshKey)}
                onRunSetup={() => setInSetup(true)}
              />
            ) : (
              <>
                <div className="mh">
                  <h1>{current.label}</h1>
                </div>
                <div className="empty">
                  <h2>{current.title}</h2>
                  <p>{current.body}</p>
                </div>
              </>
            )}
          </main>
        </div>
      )}

      {ask && <LimitAsk ask={ask} limit={prefs.dailyLimit} onClose={() => setAsk(null)} />}
      {searching && !inSetup && <Search items={searchItems()} onClose={() => setSearching(false)} />}
      {note && <Toast note={note} onClose={closeNote} />}

      {prefs.statusBar && (
        // In Threads it tells of the thread on show, wherever its project is; elsewhere, of the open project.
        <footer className="status solid">
          <span title={place ?? undefined}>{place ? folderName(place) : "No project open"}</span>
          {thread?.branch && thread.repo === place && (
            <span className="branch">
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M5 2.5v11M5 10.5c0-3 6-2 6-5.5M11 5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z" />
              </svg>
              {thread.branch}
            </span>
          )}
          <span className="r">
            {live.length > 1 && <span>{live.length} threads running</span>}
            {thread && threadRunning && prefs.showCosts && (
              <span>
                this thread <b>{formatCost(threadCost(thread))}</b>
              </span>
            )}
            {trials.trial && trialRunning && prefs.showCosts && (
              <span>
                this trial <b>{formatCost(trialProgress(trials.trial).spent)}</b>
              </span>
            )}
            {prefs.showCosts && (
              <span title="Spent today across every thread and trial, against your daily limit">
                today <b>{formatCost(spentToday)}</b> of {formatCost(prefs.dailyLimit)}
              </span>
            )}
          </span>
        </footer>
      )}
    </div>
  );
}

export default App;
