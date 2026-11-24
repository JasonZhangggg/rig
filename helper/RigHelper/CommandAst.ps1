# Rig's fixed parse script. It runs nothing from the scripts it is given: it
# parses each with PowerShell's own parser and prints, as JSON, the commands,
# their arguments, the strings and the constructs CommandCheck.cs judges, in
# the shapes of packages/core/src/powershell.ts. $args[0] is a file with one
# base64 (UTF-8) script per line; the answer is written to $args[1] as JSON.

$ErrorActionPreference = 'Stop'

$plain = 'ScriptBlockAst', 'StatementBlockAst', 'PipelineAst', 'CommandExpressionAst', 'CommandParameterAst',
    'IfStatementAst', 'WhileStatementAst', 'ForStatementAst', 'DoWhileStatementAst', 'DoUntilStatementAst',
    'TryStatementAst', 'CatchClauseAst', 'ReturnStatementAst', 'ThrowStatementAst', 'BreakStatementAst',
    'ContinueStatementAst', 'ExitStatementAst', 'MergingRedirectionAst', 'BinaryExpressionAst', 'UnaryExpressionAst',
    'ConstantExpressionAst', 'ParenExpressionAst', 'SubExpressionAst', 'ArrayExpressionAst', 'ArrayLiteralAst',
    'HashtableAst', 'IndexExpressionAst', 'ScriptBlockExpressionAst', 'ConvertExpressionAst', 'AttributedExpressionAst',
    'UsingExpressionAst', 'ErrorStatementAst', 'ErrorExpressionAst'
$keywords = @{
    FunctionDefinitionAst = 'function'; TypeDefinitionAst = 'class'; SwitchStatementAst = 'switch'; TrapStatementAst = 'trap'
    ParamBlockAst = 'param'; DataStatementAst = 'data'; ConfigurationDefinitionAst = 'configuration'; UsingStatementAst = 'using'
    BlockStatementAst = 'parallel'; DynamicKeywordStatementAst = 'configuration'
}

function Parse([string]$src) {
    $tokens = $null
    $errors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseInput($src, [ref]$tokens, [ref]$errors)
    $calls = New-Object System.Collections.ArrayList
    $finds = New-Object System.Collections.ArrayList
    $strings = New-Object System.Collections.ArrayList
    $problems = New-Object System.Collections.ArrayList
    foreach ($e in $errors) { [void]$problems.Add([string]$e.Message) }

    function Find([string]$what, [string]$detail, [bool]$hidden = $false) {
        $f = @{ what = $what; detail = $detail }
        if ($hidden) { $f.hidden = $true }
        [void]$finds.Add($f)
    }
    function Add($into, [string]$k, [string]$t, [string]$p) {
        $a = @{ k = $k; t = $t }
        if ($p) { $a.p = $p }
        [void]$into.Add($a)
    }
    function Bare($e) { $e.GetType().Name -eq 'StringConstantExpressionAst' -and [string]$e.StringConstantType -eq 'BareWord' }
    function Written($e) { (Bare $e) -and $e.Extent.Text -ceq [string]$e.Value }

    # A bare word with variables in it (key=$x): the text before each variable, then the variable as a hidden argument.
    function Pieces($e, $into, [string]$lead, [string]$param) {
        $text = $e.Extent.Text
        $start = $e.Extent.StartOffset
        $at = 0
        foreach ($n in @($e.NestedExpressions | Sort-Object { $_.Extent.StartOffset })) {
            $off = $n.Extent.StartOffset - $start
            if ($off -gt $at -or $lead) { Add $into 'bare' ($lead + $text.Substring($at, $off - $at)) $param; $lead = ''; $param = '' }
            Add $into 'hidden' '' $null
            $at = $n.Extent.EndOffset - $start
        }
        if ($at -lt $text.Length) { Add $into 'bare' $text.Substring($at) $null }
    }

    function Arguments($e, $into) {
        switch ($e.GetType().Name) {
            'CommandParameterAst' {
                $name = '-' + $e.ParameterName
                $a = $e.Argument
                if ($null -eq $a) { Add $into 'switch' $name $name; break }
                $type = $a.GetType().Name
                if ($type -eq 'StringConstantExpressionAst') {
                    $k = 'word'
                    if (Written $a) { $k = 'switch' }
                    Add $into $k ($name + ':' + [string]$a.Value) $name
                }
                elseif ($type -eq 'ConstantExpressionAst') { Add $into 'switch' ($name + ':' + $a.Extent.Text) $name }
                elseif ($type -eq 'ExpandableStringExpressionAst' -and [string]$a.StringConstantType -eq 'BareWord') { Pieces $a $into ($name + ':') $name }
                else {
                    Add $into 'switch' ($name + ':') $name
                    Arguments $a $into
                }
            }
            'ArrayLiteralAst' { foreach ($x in $e.Elements) { Arguments $x $into } }
            'StringConstantExpressionAst' {
                $k = 'word'
                if (Written $e) { $k = 'bare' }
                Add $into $k ([string]$e.Value) $null
            }
            'ConstantExpressionAst' { Add $into 'bare' $e.Extent.Text $null }
            'ExpandableStringExpressionAst' {
                if ([string]$e.StringConstantType -eq 'BareWord') { Pieces $e $into '' '' }
                else { Add $into 'hidden' ([string]$e.Value) $null }
            }
            'VariableExpressionAst' {
                $v = [string]$e.VariablePath.UserPath
                if (-not $e.Splatted -and $v -in 'null', 'true', 'false') { Add $into 'word' ('$' + $v.ToLowerInvariant()) $null }
                else { Add $into 'hidden' '' $null }
            }
            'ScriptBlockExpressionAst' { Add $into 'block' '' $null }
            default { Add $into 'hidden' '' $null }
        }
    }

    function TypeName($t) { ($t.FullName -replace '[\s`]', '').ToLowerInvariant() }

    function Member($n) {
        $m = $n.Member
        if (-not (Bare $m) -or [string]$m.Value -notmatch '^[A-Za-z_]\w*$') { Find 'dynamic-member' ''; return }
        $name = ([string]$m.Value).ToLowerInvariant()
        if ($n.Expression.GetType().Name -eq 'TypeExpressionAst') {
            $sep = '.'
            if ($n.Static) { $sep = '::' }
            Find 'static' (((TypeName $n.Expression.TypeName) -replace '^system\.', '') + $sep + $name)
            return
        }
        if ($n.Static) { Find 'static-variable' $name }
        if ($n.GetType().Name -eq 'InvokeMemberExpressionAst') { Find 'method' $name }
    }

    # Whether what is set ends in a member: $x.Prop = 1, $x.Items[0] = 1, $x.Count++.
    function SetsMember($t) {
        while ($null -ne $t -and $t.GetType().Name -in 'IndexExpressionAst', 'ConvertExpressionAst', 'AttributedExpressionAst') {
            if ($t.GetType().Name -eq 'IndexExpressionAst') { $t = $t.Target } else { $t = $t.Child }
        }
        $null -ne $t -and $t.GetType().Name -in 'MemberExpressionAst', 'InvokeMemberExpressionAst'
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
                if ($first.GetType().Name -ne 'StringConstantExpressionAst' -or ([string]$first.Value).Contains('$')) { Find 'dynamic' $first.Extent.Text; break }
                if ((Bare $first) -and $first.Extent.Text -cne [string]$first.Value) { Find 'obfuscated' ([string]$first.Value) }
                $list = New-Object System.Collections.ArrayList
                for ($i = 1; $i -lt $n.CommandElements.Count; $i++) { Arguments $n.CommandElements[$i] $list }
                $piped = $n.Parent.GetType().Name -eq 'PipelineAst' -and $n.Parent.PipelineElements.IndexOf($n) -gt 0
                [void]$calls.Add(@{ name = [string]$first.Value; piped = $piped; args = $list })
            }
            'StringConstantExpressionAst' {
                [void]$strings.Add([string]$n.Value)
                if ((Bare $n) -and ([string]$n.Value).Contains("`n")) { Find 'obfuscated' $n.Extent.Text }
            }
            'ExpandableStringExpressionAst' {
                [void]$strings.Add([string]$n.Value)
                if ([string]$n.StringConstantType -eq 'DoubleQuotedHereString' -and ([string]$n.Value).Contains('$(')) { [void]$problems.Add('commands inside a block of text') }
            }
            'VariableExpressionAst' {
                if ($n.Splatted) { Find 'splat' '' }
                else { Find 'variable' ([string]$n.VariablePath.UserPath) }
            }
            'TypeExpressionAst' {
                $p = $n.Parent
                if (-not ($p.GetType().Name -in 'MemberExpressionAst', 'InvokeMemberExpressionAst' -and [object]::ReferenceEquals($p.Expression, $n))) { Find 'type' (TypeName $n.TypeName) }
            }
            'TypeConstraintAst' { Find 'type' (TypeName $n.TypeName) }
            'AttributeAst' { Find 'type' (TypeName $n.TypeName) }
            'InvokeMemberExpressionAst' { Member $n }
            'MemberExpressionAst' { Member $n }
            'AssignmentStatementAst' {
                if (SetsMember $n.Left) { Find 'member-assign' '' }
                foreach ($v in $n.Left.FindAll({ param($x) $x.GetType().Name -eq 'VariableExpressionAst' }, $true)) { Find 'assigns' ([string]$v.VariablePath.UserPath) }
            }
            'UnaryExpressionAst' {
                if (([string]$n.TokenKind -in 'PlusPlus', 'MinusMinus', 'PostfixPlusPlus', 'PostfixMinusMinus') -and (SetsMember $n.Child)) { Find 'member-assign' '' }
            }
            'ForEachStatementAst' {
                Find 'assigns' ([string]$n.Variable.VariablePath.UserPath)
                if ([string]$n.Flags -ne 'None') { Find 'keyword' 'parallel' }
            }
            'FileRedirectionAst' {
                $to = $n.Location
                $kind = $to.GetType().Name
                if ($kind -eq 'VariableExpressionAst' -and $to.VariablePath.UserPath -eq 'null') { }
                elseif ($kind -eq 'StringConstantExpressionAst') { Find 'redirect' ([string]$to.Value) }
                elseif ($kind -eq 'ConstantExpressionAst') { Find 'redirect' $to.Extent.Text }
                else { Find 'redirect' $to.Extent.Text $true }
            }
            'NamedBlockAst' { if (-not $n.Unnamed) { Find 'keyword' ([string]$n.BlockKind).ToLowerInvariant() } }
            'PipelineAst' { if ($n.Background) { [void]$problems.Add('an & Rig can''t place') } }
            default {
                if ($keywords.ContainsKey($type)) { Find 'keyword' $keywords[$type] }
                elseif ($plain -notcontains $type) { Find 'keyword' ($type -replace 'Ast$', '') }
            }
        }
    }
    @{ errors = $problems; calls = $calls; finds = $finds; strings = $strings }
}

$parsed = New-Object System.Collections.ArrayList
foreach ($line in [System.IO.File]::ReadAllLines($args[0])) {
    if ($line.Trim()) { [void]$parsed.Add((Parse ([System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($line))))) }
}
$json = ConvertTo-Json -InputObject @{ scripts = $parsed } -Depth 8 -Compress
[System.IO.File]::WriteAllText($args[1], $json, (New-Object System.Text.UTF8Encoding $false))
