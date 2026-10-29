import { useCallback, useEffect, useState } from "react";
import { bridge as tauriBridge, type Bridge, type KeyStatus } from "./bridge";
import { folderName, HomeView } from "./home/HomeView";
import { ReceiptsView } from "./receipts/ReceiptsView";
import { usePrefs } from "./settings/prefs";
import { SettingsView } from "./settings/SettingsView";
import { StackView } from "./stack/StackView";
import { useStack } from "./stack/useStack";
import { trialProgress, useTrial } from "./stack/useTrial";
import { Mark } from "./shell/Mark";
import { Rail } from "./shell/Rail";
import { WindowControls } from "./shell/WindowControls";
import { SECTIONS, type SectionId } from "./shell/sections";
import { formatCost } from "./thread/fold";
import { ThreadView } from "./thread/ThreadView";
import { isRunning, threadCost, useThread } from "./thread/useThread";

const isMac = typeof navigator !== "undefined" && /Mac/.test(navigator.userAgent);

function App({ bridge = tauriBridge }: { bridge?: Bridge }) {
  const [section, setSection] = useState<SectionId>("home");
  const [prefs, setPrefs] = usePrefs();
  const [keyStatus, setKeyStatus] = useState<KeyStatus | null>(null);
  const stack = useStack(bridge, prefs.stack);
  const { thread, start, requestChanges, stop, commit } = useThread(bridge);
  const trials = useTrial(bridge);
  const trialRunning = !!trials.trial && trialProgress(trials.trial).running;
  const threadRunning = isRunning(thread?.turns[thread.turns.length - 1]);
  const running = threadRunning || trialRunning;
  const current = SECTIONS[section];

  const refreshKey = useCallback(() => bridge.keyStatus().then(setKeyStatus), [bridge]);
  useEffect(() => {
    refreshKey().catch(() => setKeyStatus({ saved: false, fromEnv: false }));
  }, [refreshKey]);

  const pickProject = async () => {
    const repo = await bridge.pickProject();
    if (repo) setPrefs({ repo });
  };

  return (
    <div
      className="app"
      data-state={running ? "running" : "idle"}
      data-platform={isMac ? "mac" : "other"}
      data-motion={prefs.motion ? "on" : "off"}
    >
      <header className="titlebar solid" data-tauri-drag-region>
        <div data-tauri-drag-region />
        <div className="center" data-tauri-drag-region>
          <span className="lockup" data-tauri-drag-region>
            <Mark />
            shoji
          </span>
        </div>
        <div className="right" data-tauri-drag-region>
          <span className="runlight" role="status">
            <span className="dot live" aria-hidden="true" />
            {running ? "running" : "idle"}
          </span>
          {!isMac && <WindowControls />}
        </div>
      </header>

      <div className="body">
        <Rail current={section} onSelect={setSection} />
        <main className="main">
          {section === "home" ? (
            <HomeView
              repo={prefs.repo}
              hasKey={!!keyStatus && (keyStatus.saved || keyStatus.fromEnv)}
              busy={running}
              onPickProject={pickProject}
              onOpenSettings={() => setSection("settings")}
              onStart={(task) => {
                if (!prefs.repo) return;
                setSection("threads");
                start(task, prefs.repo, stack.stack, prefs.cap);
              }}
            />
          ) : section === "receipts" ? (
            <ReceiptsView bridge={bridge} />
          ) : section === "stack" ? (
            <StackView
              bridge={bridge}
              repo={prefs.repo}
              trial={trials.trial}
              onStartTrial={trials.start}
              onStopTrial={trials.stop}
              stack={stack.stack}
              lock={stack.lock}
              error={stack.error}
              onSave={stack.save}
            />
          ) : section === "threads" && thread ? (
            <ThreadView
              bridge={bridge}
              thread={thread}
              onStop={stop}
              onRequestChanges={requestChanges}
              onCommit={commit}
            />
          ) : (
            <>
              <div className="mh">
                <h1>{current.label}</h1>
              </div>
              {section === "settings" ? (
                <SettingsView
                  prefs={prefs}
                  onChange={setPrefs}
                  stack={stack.stack}
                  onOpenStack={() => setSection("stack")}
                  keyStatus={keyStatus}
                  onSaveKey={(key) => bridge.saveKey(key).then(refreshKey)}
                  onForgetKey={() => bridge.forgetKey().then(refreshKey)}
                />
              ) : (
                <div className="empty">
                  <h2>{current.title}</h2>
                  <p>{current.body}</p>
                </div>
              )}
            </>
          )}
        </main>
      </div>

      <footer className="status solid">
        <span title={prefs.repo ?? undefined}>{prefs.repo ? folderName(prefs.repo) : "No project open"}</span>
        <span className="r">
          {thread?.branch && thread.repo === prefs.repo && <span>{thread.branch}</span>}
          {thread && threadRunning && (
            <span>
              this thread <b>{formatCost(threadCost(thread))}</b>
            </span>
          )}
          {trials.trial && trialRunning && (
            <span>
              this trial <b>{formatCost(trialProgress(trials.trial).spent)}</b>
            </span>
          )}
        </span>
      </footer>
    </div>
  );
}

export default App;
