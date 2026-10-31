import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { folderName, HomeView } from "./home/HomeView";
import { Field } from "./look/Field";
import { lookStyle } from "./look/LookRows";
import { ReceiptsView } from "./receipts/ReceiptsView";
import { useSchedules } from "./schedule/useSchedules";
import { usePrefs } from "./settings/prefs";
import { readMcpServers, SETTINGS_PAGES, type SettingsPage, SettingsView } from "./settings/SettingsView";
import { SetupView } from "./setup/SetupView";
import { notesProgress, useNotes } from "./setup/useNotes";
import { useModelCatalog } from "./stack/catalog";
import { StackView } from "./stack/StackView";
import { estimateCost, tierStack, type Tier } from "./stack/tier";
import { useStack } from "./stack/useStack";
import { trialProgress, useTrial } from "./stack/useTrial";
import { Mark } from "./shell/Mark";
import type { SlashCommand } from "./shell/mention";
import { Rail } from "./shell/Rail";
import { WindowControls } from "./shell/WindowControls";
import { Search, type SearchItem } from "./shell/Search";
import { SECTIONS, type SectionId } from "./shell/sections";
import { formatCost } from "./thread/fold";
import { DEFAULT_PREVIEW } from "./thread/PreviewView";
import { reopen, workThreads } from "./thread/reopen";
import { threadState } from "./thread/ThreadList";
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
  const [section, setSection] = useState<SectionId>("home");
  const [settingsPage, setSettingsPage] = useState<SettingsPage>("look");
  const [prefs, setPrefs] = usePrefs();
  const catalog = useModelCatalog(prefs.updateModels);
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
    build,
    replan,
    question,
    stop,
    answer,
    commit,
    open,
    showId,
  } = useThreads(bridge, allowedIn);
  const servers = useServers(bridge);
  const terminals = useTerminals(bridge);
  const trials = useTrial(bridge);
  const trialRunning = !!trials.trial && trialProgress(trials.trial).running;
  const notes = useNotes(bridge);
  const notesRunning = !!notes.notes && notesProgress(notes.notes).running;
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

  // Changes whenever a thread gets its ledger id, starts or ends a run, or is committed.
  const activity = threads.map((t) => `${t.id}:${t.turns.length}:${isRunning(t.turns.at(-1))}:${t.committed}`).join();
  // The ledger, read again whenever a run starts or ends: the thread list, today's spend for the daily limit,
  // recent tasks for Home's estimate, and Stack's Watching row.
  const [ledger, setLedger] = useState<LedgerThread[]>([]);
  useEffect(() => {
    bridge
      .ledgerThreads()
      .then(setLedger)
      .catch(() => setLedger([]));
    // Read again on a commit or on opening Threads too, so each thread shows where it got to.
  }, [bridge, activity, trialRunning, notesRunning, section]);
  const pastThreads = useMemo(() => workThreads(ledger), [ledger]);
  const liveIdsKey = live.map((t) => t.id).join();
  const liveIds = useMemo(() => new Set(live.flatMap((t) => (t.id === undefined ? [] : [t.id]))), [liveIdsKey]);
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

  const [startProblem, setStartProblem] = useState<string | null>(null);
  const openRecord = async (record: LedgerThread) => {
    if (!showId(record.id)) open(await reopen(bridge, record, prefs.cap));
    setSection("threads");
  };
  const projects = useMemo(() => projectsFrom(pastThreads, liveIds, prefs.repo), [pastThreads, liveIdsKey, prefs.repo]);
  const recent = useMemo(
    () =>
      pastThreads
        .filter((t) => t.repo === prefs.repo)
        .map((thread) => ({ thread, ...threadState(thread, liveIds) }))
        .filter((t) => t.group !== "Earlier")
        .slice(0, 3),
    [pastThreads, liveIdsKey, prefs.repo],
  );

  // Search, from the title bar or Ctrl+K (⌘K on a Mac), anywhere in the app.
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "k" || !(isMac ? e.metaKey : e.ctrlKey) || e.altKey || e.shiftKey) return;
      e.preventDefault();
      setSearching((open) => !open);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const searchItems = (): SearchItem[] => [
    ...pastThreads.map((t) => ({
      id: `thread-${t.id}`,
      group: "Threads",
      label: t.task.split("\n")[0],
      detail: `${threadState(t, liveIds).status} · ${folderName(t.repo)}`,
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
      pastThreads
        .map((record) => ({ record, ...threadState(record, liveIds) }))
        .filter((a) => a.group !== "Earlier")
        .sort((a, b) => (a.group === b.group ? 0 : a.group === "Running" ? -1 : 1))
        .map(({ record, status }) => ({ record, status, live: threads.find((t) => t.id === record.id) })),
    [pastThreads, liveIdsKey, threads],
  );

  const pickProject = async () => {
    const repo = await bridge.pickProject();
    if (repo) {
      setPrefs({ repo });
      setStartProblem(null);
    }
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
                  repo={prefs.repo}
                  hasKey={hasKey}
                  onPickProject={pickProject}
                  onOpenSettings={() => {
                    setSettingsPage("models");
                    setSection("settings");
                  }}
                  problem={startProblem}
                  planFirst={prefs.planFirst}
                  onTogglePlanFirst={() => setPrefs({ planFirst: !prefs.planFirst })}
                  tier={tier}
                  onTier={setTier}
                  estimate={estimate}
                  onPickAttachments={() => bridge.pickAttachments()}
                  onSavePasted={async (image) =>
                    bridge.saveAttachment(
                      image.name || "pasted.png",
                      Array.from(new Uint8Array(await image.arrayBuffer())),
                    )
                  }
                  files={projectFiles}
                  commands={projectCommands}
                  recent={recent}
                  onOpenThread={openRecord}
                  showCosts={prefs.showCosts}
                  onSchedule={(task, when) => {
                    if (!prefs.repo) return;
                    const schedule = {
                      id: crypto.randomUUID(),
                      task,
                      repo: prefs.repo,
                      tier,
                      created: Date.now(),
                      ...when,
                    };
                    setPrefs({ schedules: [...prefs.schedules, schedule] });
                    setSection("threads");
                  }}
                  onStart={async (task, attachments) => {
                    const repo = prefs.repo;
                    if (!repo) return false;
                    // Checked here so the task stays in the composer while the person sorts the folder out.
                    const problem = await folderProblem(bridge, repo);
                    setStartProblem(problem);
                    if (problem) return false;
                    return withinDay("This thread", prefs.cap, () => {
                      setSection("threads");
                      start(task, repo, tierStack(stack.stack, tier), prefs.cap, prefs.planFirst, attachments);
                    });
                  }}
                />
              </div>
            ) : section === "receipts" ? (
              <ReceiptsView bridge={bridge} />
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
              />
            ) : section === "threads" && (thread || pastThreads.length > 0 || prefs.schedules.length > 0) ? (
              <div className="threads">
                {(pastThreads.length > 0 || prefs.schedules.length > 0) && (
                  <ThreadList
                    schedules={prefs.schedules}
                    onPause={(id) =>
                      setPrefs({
                        // Times missed while paused stay missed.
                        schedules: prefs.schedules.map((s) =>
                          s.id === id ? { ...s, paused: !s.paused, ...(s.paused && { last: Date.now() }) } : s,
                        ),
                      })
                    }
                    onRemove={(id) => setPrefs({ schedules: prefs.schedules.filter((s) => s.id !== id) })}
                    threads={pastThreads}
                    running={liveIds}
                    current={thread?.id}
                    showCosts={prefs.showCosts}
                    onOpen={openRecord}
                    onNew={() => setSection("home")}
                  />
                )}
                {thread ? (
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
                      withinDay("This thread", thread.cap, () =>
                        start(thread.task, thread.repo, thread.stack, thread.cap, prefs.planFirst, thread.attachments),
                      )
                    }
                    onBuild={build}
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
                  />
                ) : (
                  <div className="empty">
                    <h2>Pick a thread</h2>
                    <p>Read its plan, steps and review again, or carry it on where it stopped.</p>
                  </div>
                )}
              </div>
            ) : section === "agents" ? (
              <AgentsView agents={agents} showCosts={prefs.showCosts} onOpen={openRecord} />
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

      {prefs.statusBar && (
        <footer className="status solid">
          <span title={prefs.repo ?? undefined}>{prefs.repo ? folderName(prefs.repo) : "No project open"}</span>
          <span className="r">
            {thread?.branch && thread.repo === prefs.repo && <span>{thread.branch}</span>}
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
          </span>
        </footer>
      )}
    </div>
  );
}

export default App;
