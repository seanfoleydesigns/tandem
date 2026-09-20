// The few chrome.* calls this extension makes, typed by hand so the project needs no new dependency.
// Signatures follow developer.chrome.com/docs/extensions/reference (checked 2026-09-19).
declare namespace chrome {
  type Tab = { id?: number; url?: string; status?: string };
  type Sender = { tab?: Tab };
  type Event<F> = { addListener(listener: F): void };

  namespace action {
    const onClicked: Event<(tab: Tab) => void>;
    function setBadgeText(d: { text: string; tabId?: number }): Promise<void>;
    function setBadgeBackgroundColor(d: { color: string; tabId?: number }): Promise<void>;
    function setTitle(d: { title: string; tabId?: number }): Promise<void>;
  }
  namespace permissions {
    function request(p: { origins: string[] }): Promise<boolean>;
    function contains(p: { origins: string[] }): Promise<boolean>;
    const onRemoved: Event<(p: { origins?: string[] }) => void>;
  }
  namespace scripting {
    function executeScript(d: { target: { tabId: number }; files: string[] }): Promise<unknown>;
  }
  namespace tabs {
    const onUpdated: Event<(tabId: number, change: { status?: string; url?: string }, tab: Tab) => void>;
    const onRemoved: Event<(tabId: number) => void>;
    function get(tabId: number): Promise<Tab>;
    function sendMessage(tabId: number, message: unknown): Promise<unknown>;
  }
  namespace runtime {
    const onMessage: Event<(message: unknown, sender: Sender, sendResponse: (response?: unknown) => void) => boolean | void>;
    function sendMessage(message: unknown): Promise<unknown>;
    const id: string | undefined;
  }
  namespace tts {
    type TtsEvent = { type: string; errorMessage?: string };
    // enqueue defaults to FALSE: a new phrase would cut off the one being spoken.
    function speak(utterance: string, options?: { enqueue?: boolean; rate?: number; lang?: string; onEvent?: (event: TtsEvent) => void }): Promise<void>;
    function stop(): void; // stops the phrase being spoken and empties the queue, for the WHOLE extension, not one tab
    function isSpeaking(): Promise<boolean>;
  }
  namespace storage {
    type Area = { get(keys?: string | string[] | null): Promise<Record<string, unknown>>; set(items: Record<string, unknown>): Promise<void>; remove(keys: string | string[]): Promise<void> };
    const session: Area;
    const local: Area;
  }
}
