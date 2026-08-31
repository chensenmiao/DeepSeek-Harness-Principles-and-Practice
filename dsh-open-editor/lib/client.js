/**
 * dsh-open-editor — Browser half (client.js bundle).
 *
 * A session-header utility button (beside the session-log download) that
 * opens the current session working directory in the user's local editor.
 *
 * The button triggers the host `/open-editor` command through the existing
 * `commands` Remote namespace (`ctx.remote.commands.execute`), which the web
 * app already mounts — no typert generation is needed on this package.
 *
 * This file is a hand-written client bundle in the module-table format the
 * dsh web shell loads: `window.__ModuleLoader__.load({ id, factory })`.
 * `id` must equal this package's npm name (`dsh-open-editor`), because the
 * entry id that the module graph keys on is the package name. The factory
 * receives the synchronous module-table `require` and returns the plugin
 * exports (`inject` + `apply`). React is a baseline external.
 */

window.__ModuleLoader__.load({
  id: "dsh-open-editor",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    var react = require("react");

    /** Required services: the slot registry and the commands Remote namespace. */
    var inject = ["slots", "remote", "remote.commands"];

    /** Resolved once inside apply; used by the button's click handler. */
    var commandsRemote = null;

    /**
     * The header utility button. Receives the standard session props
     * (sessionId) from the slot owner.
     */
    function OpenEditorButton(props) {
      var sessionId = props && props.sessionId;
      var state = react.useState({ busy: false, error: null });
      var view = state[0];
      var setView = state[1];

      var onClick = function () {
        if (view.busy || commandsRemote === null) return;
        setView({ busy: true, error: null });
        Promise.resolve(commandsRemote.execute(sessionId, "/open-editor", []))
          .then(function (res) {
            // `remote.commands.execute` returns a RemoteResult `{ ok, value, error? }`.
            // `value` is undefined when the command name does not resolve.
            if (!res) return { ok: false, error: "failed to open editor" };
            if (!res.ok) return { ok: false, error: (res.error && (res.error.message || res.error.code)) || "failed to open editor" };
            if (res.value === undefined || res.value === null) return { ok: false, error: "/open-editor command not found" };
            var result = res.value.result;
            if (!result) return { ok: false, error: "no command result" };
            if (result.kind === "error") return { ok: false, error: result.text || "command failed" };
            return { ok: true };
          })
          .catch(function () {
            return { ok: false, error: "failed to open editor" };
          })
          .then(function (outcome) {
            setView({ busy: false, error: outcome.ok ? null : outcome.error });
          });
      };

      return react.createElement(
        "button",
        {
          type: "button",
          onClick: onClick,
          disabled: view.busy,
          title: view.error ? view.error : "Open in editor",
          style: {
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            cursor: view.busy ? "default" : "pointer",
            border: "1px solid rgba(127,127,127,0.35)",
            background: "transparent",
            color: "inherit",
            borderRadius: 6,
            padding: "3px 9px",
            fontSize: 12,
            lineHeight: "16px",
            opacity: view.busy ? 0.6 : 1,
          },
        },
        react.createElement("span", { "aria-hidden": "true", style: { fontSize: 13, lineHeight: 1 } }, "\u2328"),
        view.busy ? "Opening\u2026" : "Editor",
      );
    }

    /** Cordis plugin body. */
    function apply(ctx) {
      var slots = ctx.get("slots");
      if (slots === undefined) return;
      var remote = ctx.get("remote");
      if (remote === undefined || remote.commands === undefined) return;
      commandsRemote = remote.commands;

      slots.inject("conversation.session.header.utilities", function () {
        return slots.register(
          { name: "conversation.session.header.utilities", id: "open-editor", order: 0 },
          function (props) { return react.createElement(OpenEditorButton, props); },
        );
      });
    }

    module.exports = { inject: inject, apply: apply };
    return module.exports;
  },
});
