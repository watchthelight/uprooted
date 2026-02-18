# Message Logger

Logs deleted and edited messages so they remain visible in chat with visual indicators. Deleted messages appear with red styling; edited messages show their version history inline.

> **Status:** Planned -- not yet implemented
> **Layer:** C# hook (Avalonia-native) -- chat is not rendered in DotNetBrowser
> **Reference pattern:** [`hook/LinkEmbedEngine.cs`](../../../hook/LinkEmbedEngine.cs)

---

## What it does

When someone deletes a message, Root removes it from the chat entirely. When someone edits a message, Root replaces the content with no trace of the original. Message Logger intercepts these events, caches the original content, and modifies the visual tree to keep deleted/edited messages visible.

| Event | Default Root behavior | With Message Logger |
|-------|----------------------|-------------------|
| Message deleted | Message disappears from chat | Message stays, shown with red styling |
| Message edited | Content silently replaced | New content shown, edit history accessible |

This mirrors Vencord's MessageLogger plugin, adapted from DOM manipulation to Avalonia visual tree manipulation.

## How it works

### Detection: gRPC interception (preferred)

Message deletion and edit events arrive as gRPC responses from Root's backend. Intercepting at the gRPC layer provides unambiguous signals:

- **Deletion:** The gRPC response explicitly signals which message ID was removed
- **Edit:** The gRPC response carries the new content for a message ID, allowing the previous version to be cached before the UI updates

This approach requires the **gRPC message interception layer** -- a framework-level capability not yet built. See [gRPC Protocol Reference](../../research/GRPC_PROTOCOL.md) for the protocol details.

### Detection: visual tree watching (fallback)

Monitor the chat's `VirtualizingStackPanel` for child removals. This is less reliable because Avalonia's virtualization constantly adds and removes children as the user scrolls -- distinguishing a genuine deletion from recycling requires heuristics that will produce false positives.

Visual tree watching alone is not sufficient for edit detection since the control is reused in-place with new text.

### Storage

Logged messages are stored in a flat file (not System.Text.Json -- broken in profiler context). Per-message record:

```
Message ID
Channel/room ID
Author (display name or user ID)
Original content
Edit history (timestamped list of previous versions)
Deletion timestamp (if deleted)
```

A retention policy prevents unbounded growth:

| Policy | Description |
|--------|-------------|
| Count-based | Keep the last N messages (e.g., 1000) |
| Time-based | Keep messages from the last N hours (e.g., 24) |
| Size-based | Cap the log file at N megabytes (e.g., 10) |

The default policy and limits are TBD. All three options may be exposed as settings.

### Display: deleted messages

Deleted messages are re-injected into the visual tree using the same reflection-based Avalonia control creation as LinkEmbedEngine (Border, TextBlock, StackPanel via `AvaloniaReflection`).

Two display styles:

- **Red overlay** -- the message content is shown inside a semi-transparent red-tinted Border. The message is fully visible.
- **Red text** -- the message content is displayed in red text with a "[deleted]" label. More subtle.

If "Collapse Deleted" is enabled, the deleted message is hidden behind a clickable "Show deleted message" control that expands on click.

### Display: edited messages

Edit history is shown below the current message content:

- **Inline mode** -- previous versions appear as faded TextBlocks below the current text, each prefixed with a timestamp. Most recent edit on top.
- **Tooltip mode** -- a small "(edited)" label appears after the message. Hovering or clicking shows the version history in a popup.

Each previous version includes the timestamp of when it was replaced.

## Lifecycle

**Initialization (Phase 4.5+):**
1. Register gRPC interception handlers for message delete and message update responses
2. Load the message log from the flat file into an in-memory cache
3. Begin visual tree monitoring for chat content (to inject display controls for cached messages)

**Runtime:**
1. On delete event: cache the message content, inject the deleted-message control into the visual tree
2. On edit event: cache the previous content in the edit history, inject the edit-history control
3. On scroll/virtualization: re-inject controls for cached messages as they come back into view
4. Periodically flush the in-memory cache to the flat file
5. Apply retention policy on flush (evict oldest entries past the limit)

**Shutdown:**
1. Flush any unsaved cache to disk
2. Remove injected visual tree controls
3. Deregister gRPC interception handlers

## Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| Log Deletes | bool | `true` | Log deleted messages |
| Log Edits | bool | `true` | Log edited messages |
| Delete Style | select | `"red overlay"` | How deleted messages appear: "red overlay" or "red text" |
| Collapse Deleted | bool | `false` | Hide deleted message content behind click-to-reveal |
| Inline Edits | bool | `true` | Show edit history inline below message vs. tooltip-only |
| Ignore Bots | bool | `false` | Skip logging messages from bots |
| Ignore Self | bool | `false` | Skip logging your own messages |
| Ignore Users | text | *(empty)* | Comma-separated user IDs to exclude from logging |

Settings are managed through `UprootedSettings` (INI-based, 10s TTL cache).

## Prerequisites

This plugin depends on capabilities that are not yet built:

1. **gRPC message interception layer** -- framework-level capability to intercept gRPC-web traffic between Root's UI and its backend. Required for reliable deletion/edit detection. Also needed by the planned ClearURLs plugin.
2. **Reliable visual tree change detection** -- utility to distinguish genuine content changes from VirtualizingStackPanel recycling. Useful as a supplementary signal but not sufficient alone.

## Known Limitations

- **No System.Text.Json** -- all serialization must use manual string formatting or INI-style parsing due to MissingMethodException in profiler context
- **VirtualizingStackPanel recycling** -- injected controls are destroyed when scrolled out of view and must be re-injected when scrolled back. The LinkEmbedEngine pattern handles this but adds complexity.
- **Storage is local-only** -- logged messages are stored on the user's machine. There is no sync across devices.
- **Retention policy discards data** -- once a logged message is evicted by the retention policy, it cannot be recovered
- **No image/attachment logging** -- only text content is logged. Deleted images or file attachments are not cached.
- **gRPC protocol changes** -- Root backend updates may change the gRPC message format, breaking detection. The interception layer will need maintenance as Root evolves.
- **Performance impact** -- caching every message's content in memory adds baseline memory usage proportional to the retention window
