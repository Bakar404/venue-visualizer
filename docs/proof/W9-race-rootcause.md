# W9: Studio chat lost its bottom pin after appending messages

The first unchanged full run passed. With the full suite still parallel and UT1 repeated three times alongside the other tests, two runs of the viewport-shrink case failed **before** `setViewportSize`: after `fillChat`, the gap stayed at 290 px and 304 px for the entire poll ([red output](./W9-race-red.txt)).

## Cause

The old scroll handler recomputed `stickRef` from the *current* distance to the bottom on every `scroll` event. That included events queued by the app's own `scrollTop` write in the `ResizeObserver` or its jump when sending. The browser applied the write against the old layout, but could deliver the event after React appended the pending bubble or reply. The handler then saw the old offset against the new, larger scroll range. Once the gap exceeded 80 px, it read that as the reader scrolling away. The observer checked the now-false flag and skipped its correction, so waiting longer did not restore the pin.

The regression test reproduces that ordering without sending another message or simulating any user input: a content reflow makes the app scroll to the bottom, then the capture listener for that native event grows the content another 200 px before React handles it. The pre-fix app is still 200 px from the bottom after the poll. This does not require a pill click, smooth scrolling, a viewport resize, or a late font or image load; load makes the original event/commit ordering more likely.

## Fix

The chat remembers the reader's intent and the last applied or observed scroll offset. A delayed event at the same offset (including a clamp from shrinking layout) no longer changes the pin. Only movement up and out of the 80 px follow zone disengages it; the reader can scroll back near the end to follow again. Before an automatic correction the chat also checks for reader movement whose event has not arrived yet. Native scroll anchoring is disabled for this log so it cannot move the offset independently.

While pinned, the log scrolls synchronously with `behavior: "auto"` in `useLayoutEffect` after chat content commits, and a `ResizeObserver` on both the content and the viewport handles later reflows. Sending or activating **New message** resumes following immediately. The pill still appears for replies while reading older messages, and activating it still focuses the newest bubble without initiating another scroll (W10).

## Test synchronization

`holdMock().reached()` only means the request is parked, not that the pending bubble is on screen and scrollable. Previously the helper could see `scrollTop === 0` in the fresh conversation and skip the intended up-scroll before React committed the long first message. UT1 now waits for the pending bubble and a pinned offset above the scroll target, then waits for the actual scroll event before releasing the reply. Post-reply checks wait for the thinking indicator to leave the DOM, and the resize check waits for the viewport to shrink and the log to reach the bottom instead of assuming two frames are enough. No timeouts were increased.

Playwright used port 3300 throughout. See the [green output](./W9-race-green.txt) for the full-suite runs and UT1 repetitions. The refreshed [mobile Plan screenshot](./UT1-mobile-plan-tab.png) shows the newest reply at the bottom without a spurious New message pill.
