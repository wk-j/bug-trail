# Configuration

bug-trail keeps its settings in a config file, so nothing has to be exported.

```bash
bug-trail config set server https://bugs.example.com
bug-trail config set token        # prompts; what you type isn't echoed
bug-trail config list
```

## Keys

| Key | Environment variable | Default | Used by |
|---|---|---|---|
| `server` | `BUG_TRAIL_SERVER` | none: trails stay local | `push`, and the skill to decide whether to upload |
| `token` | `BUG_TRAIL_TOKEN` | none | `push` to upload; `serve` to accept uploads |
| `dir` | `BUG_TRAIL_DIR` | `~/.bug-trail/trails` | `serve`, `prompt`, and the skill as the place to write trails |

`set server` checks that the value is an http(s) URL. `set dir` expands `~` and stores an
absolute path.

## Which value is used

Each value is taken from, in order:

1. a command-line flag, such as `push --server`
2. the environment variable
3. the config file
4. the default

Environment variables win over the file, so a container (like the [Docker setup](deploy.md)) or a
one-off shell can override it. `bug-trail config list` shows where each value came from.

The skill asks the CLI for these values (`bug-trail config get dir`, `bug-trail config get
server`), so agents follow the same settings without reading the file themselves.

## The file

The file is `~/.config/bug-trail/config.json`, or `$XDG_CONFIG_HOME/bug-trail/config.json` if
that is set, or the path in `BUG_TRAIL_CONFIG`. `bug-trail config path` prints it.

It is created readable only by you (mode `600`), because it can hold the token. Prefer
`bug-trail config set token` with no value: a token typed on the command line stays in your shell
history, and bug-trail warns when you do that.
