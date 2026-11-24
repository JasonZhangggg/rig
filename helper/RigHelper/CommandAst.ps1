# Rig's fixed parse script. It runs nothing from the scripts it is given: it
# parses each with PowerShell's own parser and prints, as JSON, the commands
# and the constructs CommandCheck.cs judges. $args[0] is a file with one
# base64 (UTF-8) script per line; the answer is written to $args[1] as JSON.

$ErrorActionPreference = 'Stop'

$plain = 'ScriptBlockAst', 'StatementBlockAst', 'PipelineAst', 'CommandExpressionAst', 'CommandParameterAst',
    'IfStatementAst', 'WhileStatementAst', 'ForStatementAst', 'DoWhileStatementAst', 'DoUntilStatementAst',
    'TryStatementAst', 'CatchClauseAst', 'ReturnStatementAst', 'ThrowStatementAst', 'BreakStatementAst',
    'ContinueStatementAst', 'ExitStatementAst', 'MergingRedirectionAst', 'BinaryExpressionAst', 'UnaryExpressionAst',
    'ConstantExpressionAst', 'ParenExpressionAst', 'SubExpressionAst', 'ArrayExpressionAst', 'ArrayLiteralAst',
    'HashtableAst', 'IndexExpressionAst', 'ScriptBlockExpressionAst', 'ConvertExpressionAst', 'AttributedExpressionAst',
    'UsingExpressionAst'
$keywords = @{
    FunctionDefinitionAst = 'function'; TypeDefinitionAst = 'class'; SwitchStatementAst = 'switch'; TrapStatementAst = 'trap'
    ParamBlockAst = 'param'; DataStatementAst = 'data'; ConfigurationDefinitionAst = 'configuration'; UsingStatementAst = 'using'
    BlockStatementAst = 'parallel'; DynamicKeywordStatementAst = 'configuration'
}
$scopes = 'env', 'global', 'script', 'local', 'private', 'using'

function Parse([string]$src) {
    $tokens = $null
    $errors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseInput($src, [ref]$tokens, [ref]$errors)
    $calls = New-Object System.Collections.ArrayList
    $finds = New-Object System.Collections.ArrayList
    $problems = New-Object System.Collections.ArrayList
    foreach ($e in $errors) { [void]$problems.Add([string]$e.Message) }

    function Find([string]$what, [string]$detail) { [void]$finds.Add(@{ what = $what; detail = $detail }) }

    function Seen([string]$text) {
        if ($text.Contains('\\') -or $text.StartsWith('//')) { Find 'unc' $text }
        $low = $text.ToLowerInvariant()
        if ($low.StartsWith('alias:') -or $low.StartsWith('function:')) { Find 'provider-variable' $text }
    }

    function Bare($e) {
        $e.GetType().Name -eq 'StringConstantExpressionAst' -and [string]$e.StringConstantType -eq 'BareWord'
    }

    function Arguments($e, $into) {
        switch ($e.GetType().Name) {
            'CommandParameterAst' {
                $name = '-' + $e.ParameterName
                if ($null -eq $e.Argument) { [void]$into.Add(@{ k = 'switch'; t = $name }) }
                elseif ($e.Argument.GetType().Name -in 'StringConstantExpressionAst', 'ConstantExpressionAst') {
                    $whole = (Bare $e.Argument) -and $e.Argument.Extent.Text -ceq [string]$e.Argument.Value
                    if ($e.Argument.GetType().Name -eq 'ConstantExpressionAst') { $whole = $true }
                    $kind = 'word'
                    if ($whole) { $kind = 'switch' }
                    [void]$into.Add(@{ k = $kind; t = $name + ':' + [string]$e.Argument.Value })
                }
                else {
                    [void]$into.Add(@{ k = 'switch'; t = $name + ':' })
                    Arguments $e.Argument $into
                }
            }
            'ArrayLiteralAst' { foreach ($x in $e.Elements) { Arguments $x $into } }
            'StringConstantExpressionAst' {
                if ((Bare $e) -and ([string]$e.Value).Contains("`n")) { Find 'obfuscated' $e.Extent.Text }
                [void]$into.Add(@{ k = 'word'; t = [string]$e.Value; b = ((Bare $e) -and $e.Extent.Text -ceq [string]$e.Value) })
            }
            'ConstantExpressionAst' { [void]$into.Add(@{ k = 'word'; t = $e.Extent.Text; b = $true }) }
            'ExpandableStringExpressionAst' { [void]$into.Add(@{ k = 'hidden'; t = [string]$e.Value }) }
            'VariableExpressionAst' {
                $v = $e.VariablePath.UserPath
                if (-not $e.Splatted -and $v -in 'null', 'true', 'false') { [void]$into.Add(@{ k = 'word'; t = '$' + $v.ToLowerInvariant() }) }
                else { [void]$into.Add(@{ k = 'hidden'; t = '' }) }
            }
            'ScriptBlockExpressionAst' { [void]$into.Add(@{ k = 'block'; t = '' }) }
            default { [void]$into.Add(@{ k = 'hidden'; t = '' }) }
        }
    }

    foreach ($n in $ast.FindAll({ $true }, $true)) {
        $type = $n.GetType().Name
        switch ($type) {
            'CommandAst' {
                $first = $n.CommandElements[0]
                $op = [string]$n.InvocationOperator
                if ($op -eq 'Dot') { Find 'dot-source' '' }
                foreach ($e in $n.CommandElements) { if ($e.Extent.Text -eq '--%') { [void]$problems.Add('the --% marker') } }
                if ($first.GetType().Name -eq 'ScriptBlockExpressionAst' -and $op -ne 'Unknown') { break }
                if ($first.GetType().Name -ne 'StringConstantExpressionAst') { Find 'dynamic' $first.Extent.Text; break }
                if ((Bare $first) -and $first.Extent.Text -cne [string]$first.Value) { Find 'obfuscated' ([string]$first.Value) }
                if ((Bare $first) -and ([string]$first.Value).Contains('$')) { Find 'dynamic' ([string]$first.Value) }
                $list = New-Object System.Collections.ArrayList
                for ($i = 1; $i -lt $n.CommandElements.Count; $i++) { Arguments $n.CommandElements[$i] $list }
                foreach ($r in $n.Redirections) { [void]$list.Add(@{ k = 'word'; t = '>' }) }
                $piped = $n.Parent.GetType().Name -eq 'PipelineAst' -and $n.Parent.PipelineElements.IndexOf($n) -gt 0
                [void]$calls.Add(@{ name = [string]$first.Value; piped = $piped; args = $list })
            }
            'StringConstantExpressionAst' { Seen ([string]$n.Value) }
            'ExpandableStringExpressionAst' {
                Seen ([string]$n.Value)
                if ([string]$n.StringConstantType -eq 'DoubleQuotedHereString' -and ([string]$n.Value).Contains('$(')) { [void]$problems.Add('commands inside a block of text') }
            }
            'VariableExpressionAst' {
                if ($n.Splatted) { Find 'splat' '' }
                $v = [string]$n.VariablePath.UserPath
                $colon = $v.IndexOf(':')
                if ($colon -gt 0 -and $scopes -notcontains $v.Substring(0, $colon).ToLowerInvariant()) { Find 'provider-variable' $v }
            }
            'TypeExpressionAst' { Find 'type' (($n.TypeName.FullName -replace '[\s`]', '').ToLowerInvariant()) }
            'TypeConstraintAst' { Find 'type' (($n.TypeName.FullName -replace '[\s`]', '').ToLowerInvariant()) }
            'AttributeAst' { Find 'type' (($n.TypeName.FullName -replace '[\s`]', '').ToLowerInvariant()) }
            'InvokeMemberExpressionAst' {
                if (-not (Bare $n.Member) -or [string]$n.Member.Value -notmatch '^[A-Za-z_]\w*$') { Find 'dynamic-member' '' }
                elseif (-not $n.Static) { Find 'method' ([string]$n.Member.Value).ToLowerInvariant() }
                elseif ($n.Expression.GetType().Name -ne 'TypeExpressionAst') { Find 'dynamic-member' '' }
            }
            'MemberExpressionAst' {
                if (-not (Bare $n.Member) -or [string]$n.Member.Value -notmatch '^[A-Za-z_]\w*$') { Find 'dynamic-member' '' }
            }
            'AssignmentStatementAst' {
                foreach ($v in $n.Left.FindAll({ param($x) $x.GetType().Name -eq 'VariableExpressionAst' }, $true)) { Find 'assigns' ([string]$v.VariablePath.UserPath) }
            }
            'ForEachStatementAst' {
                Find 'assigns' ([string]$n.Variable.VariablePath.UserPath)
                if ([string]$n.Flags -ne 'None') { Find 'keyword' 'parallel' }
            }
            'FileRedirectionAst' {
                $to = $n.Location
                if (-not ($to.GetType().Name -eq 'VariableExpressionAst' -and $to.VariablePath.UserPath -eq 'null')) { Find 'redirect' $to.Extent.Text }
            }
            'NamedBlockAst' { if (-not $n.Unnamed) { Find 'keyword' ([string]$n.BlockKind).ToLowerInvariant() } }
            'PipelineAst' { if ($n.Background) { [void]$problems.Add('an & Rig can''t place') } }
            default {
                if ($keywords.ContainsKey($type)) { Find 'keyword' $keywords[$type] }
                elseif ($plain -notcontains $type) { Find 'keyword' ($type -replace 'Ast$', '') }
            }
        }
    }
    @{ errors = $problems; calls = $calls; finds = $finds }
}

$parsed = New-Object System.Collections.ArrayList
foreach ($line in [System.IO.File]::ReadAllLines($args[0])) {
    if ($line.Trim()) { [void]$parsed.Add((Parse ([System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($line))))) }
}
$json = ConvertTo-Json -InputObject @{ scripts = $parsed } -Depth 8 -Compress
[System.IO.File]::WriteAllText($args[1], $json, (New-Object System.Text.UTF8Encoding $false))
