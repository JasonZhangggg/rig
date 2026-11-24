# Rig's fixed parse script. It runs nothing from the scripts it is given: each
# line on standard input is one script as base64 UTF-8, and each line it prints
# is that script's commands and the constructs Rig's rules care about, as JSON,
# read from PowerShell's own syntax tree. CommandCheck.cs judges what it finds.

$ErrorActionPreference = 'Stop'

$plain = @('ScriptBlockAst', 'NamedBlockAst', 'StatementBlockAst', 'PipelineAst', 'CommandAst', 'CommandExpressionAst', 'CommandParameterAst',
    'StringConstantExpressionAst', 'ExpandableStringExpressionAst', 'ConstantExpressionAst', 'VariableExpressionAst', 'ScriptBlockExpressionAst',
    'HashtableAst', 'ArrayLiteralAst', 'ArrayExpressionAst', 'ParenExpressionAst', 'SubExpressionAst', 'MemberExpressionAst', 'InvokeMemberExpressionAst',
    'IndexExpressionAst', 'BinaryExpressionAst', 'UnaryExpressionAst', 'ConvertExpressionAst', 'TypeConstraintAst', 'TypeExpressionAst',
    'AssignmentStatementAst', 'IfStatementAst', 'WhileStatementAst', 'DoWhileStatementAst', 'DoUntilStatementAst', 'ForStatementAst', 'ForEachStatementAst',
    'TryStatementAst', 'CatchClauseAst', 'ReturnStatementAst', 'ThrowStatementAst', 'BreakStatementAst', 'ContinueStatementAst', 'ExitStatementAst',
    'FileRedirectionAst', 'MergingRedirectionAst', 'UsingExpressionAst')
$keywords = @('FunctionDefinitionAst', 'TrapStatementAst', 'SwitchStatementAst', 'DataStatementAst', 'TypeDefinitionAst', 'UsingStatementAst', 'ParamBlockAst',
    'ParameterAst', 'AttributeAst', 'ConfigurationDefinitionAst', 'DynamicKeywordStatementAst', 'BlockStatementAst', 'FunctionMemberAst', 'PropertyMemberAst')
$scopes = @('env', 'global', 'script', 'local', 'private', 'using')

function Quote([string]$s) {
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.Append('"')
    foreach ($c in $s.ToCharArray()) {
        $i = [int]$c
        if ($i -eq 34 -or $i -eq 92) { [void]$sb.Append('\').Append($c) }
        elseif ($i -lt 32 -or $i -gt 126) { [void]$sb.Append('\u').Append($i.ToString('x4')) }
        else { [void]$sb.Append($c) }
    }
    [void]$sb.Append('"')
    $sb.ToString()
}

function Arg([string]$kind, [string]$text) { '{"kind":' + (Quote $kind) + ',"text":' + (Quote $text) + '}' }

function Read-Script([string]$text) {
    $finds = New-Object System.Collections.Generic.List[string]
    $calls = New-Object System.Collections.Generic.List[string]
    $find = { param([string]$what, [string]$detail) $finds.Add('{"what":' + (Quote $what) + ',"detail":' + (Quote $detail) + '}') }

    $tokens = $null
    $errors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseInput($text, [ref]$tokens, [ref]$errors)
    if ($errors -and $errors.Count -gt 0) { return '{"error":' + (Quote ([string]$errors[0].Message)) + '}' }

    $argsOf = {
        param($e)
        $type = $e.GetType().Name
        if ($type -eq 'CommandParameterAst') {
            $name = '-' + $e.ParameterName.ToLowerInvariant()
            if ($null -eq $e.Argument) { Arg 'switch' $name }
            elseif ($e.Argument.GetType().Name -eq 'StringConstantExpressionAst' -or $e.Argument.GetType().Name -eq 'ConstantExpressionAst') { Arg 'switch' ($name + ':' + ([string]$e.Argument.Value).ToLowerInvariant()) }
            else { Arg 'switch' ($name + ':'); Arg 'hidden' '' }
        }
        elseif ($type -eq 'StringConstantExpressionAst') {
            if ([string]$e.StringConstantType -ne 'BareWord') { Arg 'word' $e.Value }
            elseif ($e.Extent.Text -cne $e.Value) {
                if ($e.Extent.Text.Contains('`')) { & $find 'obfuscated' $e.Extent.Text }
                Arg 'word' $e.Value.ToLowerInvariant()
            }
            elseif ($e.Value -match '^(-[a-zA-Z]|--[a-zA-Z]|/[a-zA-Z?])') { Arg 'switch' $e.Value.ToLowerInvariant() }
            else { Arg 'word' $e.Value.ToLowerInvariant() }
        }
        elseif ($type -eq 'ConstantExpressionAst') { Arg 'word' $e.Extent.Text.ToLowerInvariant() }
        elseif ($type -eq 'ExpandableStringExpressionAst') { Arg 'hidden' $e.Value }
        elseif ($type -eq 'ScriptBlockExpressionAst') { Arg 'block' '' }
        elseif ($type -eq 'ArrayLiteralAst') { foreach ($x in $e.Elements) { & $argsOf $x } }
        elseif ($type -eq 'VariableExpressionAst' -and -not $e.Splatted -and @('null', 'true', 'false') -contains $e.VariablePath.UserPath.ToLowerInvariant()) { Arg 'word' ('$' + $e.VariablePath.UserPath.ToLowerInvariant()) }
        else { Arg 'hidden' '' }
    }

    foreach ($n in $ast.FindAll({ $true }, $true)) {
        $type = $n.GetType().Name
        if ($keywords -contains $type) { & $find 'keyword' $type; continue }
        if ($plain -notcontains $type) { & $find 'stray' $type; continue }

        if ($type -eq 'CommandAst' -or $type -eq 'CommandExpressionAst') {
            foreach ($r in $n.Redirections) {
                if ($r.GetType().Name -ne 'FileRedirectionAst') { continue }
                $to = $r.Location
                $null_ = $to.GetType().Name -eq 'VariableExpressionAst' -and $to.VariablePath.UserPath -eq 'null'
                if (-not $null_) { & $find 'redirect' $to.Extent.Text }
            }
        }

        if ($type -eq 'CommandAst') {
            if ([string]$n.InvocationOperator -eq 'Dot') { & $find 'dot-source' '' }
            $first = $n.CommandElements[0]
            $kind = $first.GetType().Name
            if ($kind -eq 'ScriptBlockExpressionAst') { continue }
            if ($kind -ne 'StringConstantExpressionAst') { & $find 'dynamic' $first.Extent.Text; continue }
            if ([string]$first.StringConstantType -eq 'BareWord' -and $first.Extent.Text -cne $first.Value) { & $find 'obfuscated' $first.Extent.Text }
            if ($first.Value -match '[$`''"<>|;&{}@#,]') { & $find 'dynamic' $first.Extent.Text }
            $list = New-Object System.Collections.Generic.List[string]
            $parts = @($n.CommandElements | Select-Object -Skip 1) + @($n.Redirections) | Sort-Object { $_.Extent.StartOffset }
            foreach ($e in $parts) {
                if ($e -is [System.Management.Automation.Language.RedirectionAst]) { $list.Add((Arg 'word' '>')) }
                else { foreach ($a in (& $argsOf $e)) { $list.Add($a) } }
            }
            $pipe = $n.Parent
            $piped = $pipe.GetType().Name -eq 'PipelineAst' -and -not [object]::ReferenceEquals($pipe.PipelineElements[0], $n)
            $calls.Add('{"name":' + (Quote $first.Value) + ',"piped":' + $(if ($piped) { 'true' } else { 'false' }) + ',"args":[' + ($list -join ',') + ']}')
        }
        elseif ($type -eq 'StringConstantExpressionAst' -or $type -eq 'ExpandableStringExpressionAst') {
            $v = [string]$n.Value
            if ($v.Contains('\\') -or $v.StartsWith('//')) { & $find 'unc' $v }
            $low = $v.ToLowerInvariant()
            if ($low.StartsWith('alias:') -or $low.StartsWith('function:')) { & $find 'provider-variable' $v }
            if ($v.StartsWith('--%')) { & $find 'stray' '--%' }
        }
        elseif ($type -eq 'VariableExpressionAst') {
            if ($n.Splatted) { & $find 'splat' $n.Extent.Text }
            $name = $n.VariablePath.UserPath
            $colon = $name.IndexOf(':')
            if ($colon -gt 0 -and $scopes -notcontains $name.Substring(0, $colon).ToLowerInvariant()) { & $find 'provider-variable' $name }
        }
        elseif ($type -eq 'TypeExpressionAst' -or $type -eq 'TypeConstraintAst') {
            & $find 'type' (($n.TypeName.FullName -replace '[\s`]', '').ToLowerInvariant())
        }
        elseif ($type -eq 'MemberExpressionAst' -or $type -eq 'InvokeMemberExpressionAst') {
            $named = $n.Member.GetType().Name -eq 'StringConstantExpressionAst' -and [string]$n.Member.StringConstantType -eq 'BareWord'
            if (-not $named) { & $find 'dynamic-member' '' }
            elseif ($n.Static -and $n.Expression.GetType().Name -ne 'TypeExpressionAst') { & $find 'dynamic-member' '' }
            elseif ($type -eq 'InvokeMemberExpressionAst' -and -not $n.Static) { & $find 'method' $n.Member.Value.ToLowerInvariant() }
        }
        elseif ($type -eq 'AssignmentStatementAst') {
            foreach ($v in $n.Left.FindAll({ $args[0].GetType().Name -eq 'VariableExpressionAst' }, $true)) { & $find 'assigns' $v.VariablePath.UserPath }
        }
        elseif ($type -eq 'UnaryExpressionAst') {
            if (@('PlusPlus', 'MinusMinus', 'PostfixPlusPlus', 'PostfixMinusMinus') -contains [string]$n.TokenKind) {
                foreach ($v in $n.Child.FindAll({ $args[0].GetType().Name -eq 'VariableExpressionAst' }, $true)) { & $find 'assigns' $v.VariablePath.UserPath }
            }
        }
        elseif ($type -eq 'ScriptBlockAst') {
            if ($n.UsingStatements -and $n.UsingStatements.Count -gt 0) { & $find 'keyword' 'using' }
            if ($n.ParamBlock -or $n.DynamicParamBlock -or $n.BeginBlock -or $n.ProcessBlock) { & $find 'keyword' 'param' }
        }
        elseif ($type -eq 'NamedBlockAst') {
            if (-not $n.Unnamed) { & $find 'keyword' ([string]$n.BlockKind).ToLowerInvariant() }
        }
        elseif ($type -eq 'PipelineAst') {
            if ($n.PSObject.Properties['Background'] -and $n.Background) { & $find 'stray' '&' }
        }
        elseif ($type -eq 'ForEachStatementAst') {
            if ([string]$n.Flags -ne 'None') { & $find 'keyword' 'parallel' }
            if ($n.Label) { & $find 'stray' $n.Label }
        }
        elseif ($type -eq 'WhileStatementAst' -or $type -eq 'DoWhileStatementAst' -or $type -eq 'DoUntilStatementAst' -or $type -eq 'ForStatementAst') {
            if ($n.Label) { & $find 'stray' $n.Label }
        }
        elseif ($type -eq 'BreakStatementAst' -or $type -eq 'ContinueStatementAst') {
            if ($n.Label) { & $find 'stray' $n.Label.Extent.Text }
        }
    }
    '{"calls":[' + ($calls -join ',') + '],"finds":[' + ($finds -join ',') + ']}'
}

while ($null -ne ($line = [Console]::In.ReadLine())) {
    try { $out = Read-Script ([System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($line))) }
    catch { $out = '{"error":' + (Quote ('the parser failed: ' + $_.Exception.Message)) + '}' }
    [Console]::Out.WriteLine($out)
}
