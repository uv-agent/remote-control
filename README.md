# uv-agent remote-control plugin

This plugin starts a persistent-host web panel for remote uv-agent control.

By default it requires the `auth-code` plugin and verifies logins through the
`auth_code.verify` action. To disable this dependency, explicitly configure:

```json
{
  "plugins": {
    "remote-control": {
      "enabled": true,
      "config": {
        "auth": {"mode": "none"}
      }
    }
  }
}
```

The plugin is daemon-only (`persistent_only`) and exposes a fixed HTTP port.

Default configuration:

```json
{
  "plugins": {
    "remote-control": {
      "enabled": true,
      "config": {
        "host": "0.0.0.0",
        "port": 8788,
        "auth": {"mode": "auth-code"},
        "max_attachments": 10,
        "max_file_bytes": 52428800,
        "max_message_bytes": 104857600
      }
    }
  }
}
```

The web client sends attachments only when a turn is submitted. Images use
`[Image #N]`; files use `[File name]` and core appends the blob id when the turn
is accepted.
