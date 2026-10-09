# Widget testing: the headless runtime interface

Testing a widget is documented for creators on the website:
[testing a widget](https://overcrow.playervox.com/docs/en/testing/)
([français](https://overcrow.playervox.com/docs/testing/)), from
[`docs/content/en/testing.md`](content/en/testing.md). This file keeps what
concerns those who maintain the CLI, the scenario crate and the templates.

The scenario format, its bounds and shared test vectors live in the Rust
crate `crates/overcrow-widget-scenario`, which the CLI and the runtime
both compile.

## The runtime

`overcrow-widget-headless` is built by OverCrow's release pipeline with the
same code as the application, for Linux and Windows x86-64; the CLI pins a
version and its SHA-256 and never builds it. It validates the package as the
overlay does (a reserved `com.playervox.*` ID is accepted only in its
ephemeral test registry, never as a built-in: the scenario sets every grant)
and runs the widget's code in the same OS sandbox as the overlay: Bubblewrap
and seccomp on Linux, a Less Privileged AppContainer and a Job on Windows.
Without the sandbox it refuses to run and says so. On a Linux session
without cgroup delegation, the VM runs without its per-widget cgroup
(Bubblewrap, seccomp, the rlimits and the VM's heap ceiling still apply) and
the report says `without-cgroup`. On Windows it grants its own executable
read and execute for the AppContainer when the ACL lacks it.

The CLI pins the runtime published with OverCrow 0.6.0-beta.1
(`PIN` in `cli/src/runtime.rs`: its version and the two SHA-256 of that
release's `runtimes.json`), so `--runtime` is optional once the runtime is
in the cache; `--runtime` still names another one, such as one built from
OverCrow. The CLI does not download it. Hosted CI checks the scenarios, their fixtures and reference
images without playing them (`cli/tests/reference_widgets.rs` for the
reference widgets of `widgets/`), and the scenarios are played on Linux and
Windows before each change is merged.

`overcrow-widget test` talks to the runtime through a versioned interface
(`overcrow_widget_scenario::report`): `--version --format json`, then `run
--interface 1 --package … --scenario … --out …`, which writes the images and
prints a report. For a scenario with `assets`, `--project …` gives the
project the runtime reads them from, with the same checks as the CLI.

Only the runtime's VM runs on virtual time with a seeded `Math.random()`;
the overlay's VM refuses it. Images are compared within the schema's
`PARITY_CHANNEL_TOLERANCE` and `PARITY_MAX_DIFFERENT_PIXELS`. The Linux and
Windows runtimes rendered the Clock and stopwatch examples of `sdk/test/e2e/`
identically, pixel for pixel; the tolerance is a guard.

## Maintaining the templates

The reference images of `templates/*/tests/reference/` are recorded with the
pinned runtime: create a project from the template, run `overcrow-widget test
--update`, review the images and copy them back. `cli/tests/test_command.rs`
checks that every template's scenario is valid and has its images.
