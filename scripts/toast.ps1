# Shows a Windows notification. Text comes from environment variables so Korean and quotes
# survive the trip from Node: WWA_TOAST_TITLE, WWA_TOAST_BODY, WWA_TOAST_URL (opened on click).
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null

function Esc($s) { [Security.SecurityElement]::Escape([string]$s) }
$title = Esc $env:WWA_TOAST_TITLE
$body = Esc $env:WWA_TOAST_BODY
$url = Esc $env:WWA_TOAST_URL

$xml = @"
<toast activationType="protocol" launch="$url">
  <visual>
    <binding template="ToastGeneric">
      <text>$title</text>
      <text>$body</text>
    </binding>
  </visual>
  <actions>
    <action content="대시보드 열기" activationType="protocol" arguments="$url"/>
  </actions>
</toast>
"@

$doc = New-Object Windows.Data.Xml.Dom.XmlDocument
$doc.LoadXml($xml)
# Windows PowerShell's own AppUserModelID, so no app registration is needed.
$appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show([Windows.UI.Notifications.ToastNotification]::new($doc))
