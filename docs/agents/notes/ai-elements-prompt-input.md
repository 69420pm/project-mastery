# AI Elements prompt input (src/components/ai-elements/prompt-input.tsx)

Only `prompt-input.tsx` is installed. The attachment UI that AI Elements ships in an opt-in module (`prompt-input-attachments`, referenced at line ~1209) is not in the repo. Write attachment chips yourself.

- **Context.** `usePromptInputAttachments()` (line ~374) returns `files`, `add`, `remove`, `clear`, `openFileDialog` and `fileInputRef` (`AttachmentsContext`, line ~181). It works inside `PromptInput` or `PromptInputProvider`.
- **Only File objects.** The provider's `add` takes `File[] | FileList` and builds each item with `URL.createObjectURL` (line ~270). The state is private, so no API adds an item not backed by a File. For course materials that are not local files, keep a separate state and merge it into `onSubmit`.
- **Submit payload.** `onSubmit({ text, files: FileUIPart[] })` (`PromptInputMessage`, line ~484). `handleSubmit` (line ~844) converts only `blob:` URLs to data URLs and passes other URLs through. Use your own URLs for custom items.
- **Clearing.** Attachments clear only after `onSubmit` returns, or after its promise resolves. A rejection keeps the input.
- **Menu.** `PromptInputActionMenu`, `...Trigger`, `...Content` and `...Item` (lines ~1169-1207). Built-in actions: `PromptInputActionAddAttachments` (line ~417) and `PromptInputActionAddScreenshot` (line ~444). A custom action is a `PromptInputActionMenuItem` with your own `onSelect`.
- **Validation.** `accept`, `multiple`, `maxFiles`, `maxFileSize` and `onError({ code })` (lines ~489-512) apply to File adds only.
- **Disabling submit.** `PromptInputSubmit` (line ~1216) spreads props onto the button, so `disabled` works. `src/features/chat/components/chat.tsx:334-338` uses `disabled={!isBusy && limitReached}`. Enter in the textarea reads the submit button's `disabled` and returns early (line ~986-993), so Enter is blocked too.
- **Backspace.** An empty textarea removes the last item in `attachments.files` (line ~1000-1010). Custom items outside the provider are unaffected.
