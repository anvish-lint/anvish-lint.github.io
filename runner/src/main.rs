use std::collections::HashSet;
use std::io::{self, Read};
use std::path::Path;

use anyhow::{Context, Result};
use anvish::analysis::{self, ParseState};
use anvish::args::{Config, Severity};
use anvish::pipeline;
use anvish::shell::ShellDialect;
use anvish::syntax;

fn main() -> Result<()> {
    let mut shell = None;
    let mut severity = Severity::Style;

    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--shell" => {
                let value = args.next().context("missing value for --shell")?;
                shell = Some(parse_shell(&value)?);
            }
            "--severity" => {
                let value = args.next().context("missing value for --severity")?;
                severity = parse_severity(&value)?;
            }
            other => anyhow::bail!("unsupported argument: {other}"),
        }
    }

    let mut content = String::new();
    io::stdin()
        .read_to_string(&mut content)
        .context("failed to read shell source from stdin")?;

    let cfg = Config {
        min_severity: severity,
        include: None,
        exclude: HashSet::new(),
        dialect_override: shell,
        check_sourced: false,
        external_sources: false,
        source_paths: Vec::new(),
        extended_analysis: true,
        enable_unassigned_uppercase: false,
    };

    let path = Path::new("playground.sh");
    let syntax = syntax::analyze(&content)?;
    let root = syntax.ast.root();
    let pending = analysis::collect_pending(
        &content,
        root,
        ParseState {
            parse_cutoff: syntax.parse_cutoff,
            sc1089_positions: syntax.sc1089_positions,
            parse_diagnostics: syntax.parse_diagnostics,
        },
        cfg.include.as_ref(),
        &cfg.exclude,
        cfg.dialect_override,
        path,
        cfg.external_sources,
        cfg.source_paths.as_slice(),
        cfg.extended_analysis,
        cfg.enable_unassigned_uppercase,
    );
    let diagnostics =
        pipeline::finalize_diagnostics(&content, root, pending, &cfg, "playground.sh");
    serde_json::to_writer(io::stdout(), &diagnostics)?;
    Ok(())
}

fn parse_severity(value: &str) -> Result<Severity> {
    match value {
        "error" => Ok(Severity::Error),
        "warning" => Ok(Severity::Warning),
        "info" => Ok(Severity::Info),
        "style" => Ok(Severity::Style),
        other => anyhow::bail!("unsupported severity: {other}"),
    }
}

fn parse_shell(value: &str) -> Result<ShellDialect> {
    match value {
        "sh" => Ok(ShellDialect::Sh),
        "bash" => Ok(ShellDialect::Bash),
        "dash" => Ok(ShellDialect::Dash),
        "ksh" => Ok(ShellDialect::Ksh),
        "busybox" => Ok(ShellDialect::BusyboxSh),
        other => anyhow::bail!("unsupported shell: {other}"),
    }
}
