import QtQuick
import QtQuick.Controls
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui

// Todo in the bar: what you're working on, and today's list.
// Polls GET <url>/api/bar every 30s (the URL comes from ~/.config/todo/bar.json, written by
// desktop/install.sh) and writes through the same REST API the web app uses.
//
//   Focus        Work / Personal / Everything, optionally narrowed to one customer or project.
//                Saved in ~/.config/todo/bar-state.json; only that side is fetched or shown,
//                quick add files into it, and "Open todo" opens the app in the same focus.
//   Bar button   left = panel · middle = open the web app
//   Panel        focus switch + filter, quick add (same syntax as the app), today + in progress
//                (tick to finish, play/pause to start/stop), inbox/overdue counts
//   Hotkey       `omarchy-shell dev.todo add ""` opens the panel ready to type;
//                `omarchy-shell dev.todo focus work|personal|all` switches focus
BarWidget {
  id: root
  moduleName: "dev.todo"

  property string baseUrl: ""
  property var st: null
  property bool online: false
  property bool panelOpen: false
  property string draft: ""
  property string flash: ""
  property bool busy: false
  property string focusMode: "all"          // work | personal | all
  property var filter: null                // {kind: "customer" | "project", id, name}
  property bool pickingFilter: false
  property bool stateLoaded: false

  readonly property var tasks: st && st.tasks ? st.tasks : []
  readonly property var meetings: st && st.meetings ? st.meetings : []
  readonly property var counts: st && st.counts ? st.counts : ({})
  readonly property var filterOptions: st && st.filters ? st.filters : ({ customers: [], projects: [] })
  readonly property string focusGlyph: focusMode === "work" ? "\u{f00d6}" : focusMode === "personal" ? "\u{f02dc}" : "\u{f0756}"
  readonly property string focusName: focusMode === "work" ? "Work" : focusMode === "personal" ? "Personal" : "Everything"
  readonly property string scopeName: filter ? filter.name : (focusMode === "all" ? "Everything" : "All " + focusName.toLowerCase())
  readonly property var current: {
    for (var i = 0; i < tasks.length; i++) if (tasks[i].status === "in_progress") return tasks[i]
    return null
  }
  readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family
  readonly property color dimText: Qt.rgba(Color.popups.text.r, Color.popups.text.g, Color.popups.text.b, 0.6)
  readonly property color hoverFill: Qt.rgba(Color.popups.text.r, Color.popups.text.g, Color.popups.text.b, 0.08)

  function open() { root.panelOpen = !root.panelOpen; if (root.panelOpen) root.refresh() }
  function close() { root.panelOpen = false; root.flash = "" }
  function closeForPopoutSwitch() { close() }

  // "Due today", "Due tomorrow", "Due Fri", "Due Oct 31" (st.date is the server's today).
  function dueLabel(iso) {
    var p = iso.split("-"), t = (root.st ? root.st.date : iso).split("-")
    var due = new Date(+p[0], +p[1] - 1, +p[2]), today = new Date(+t[0], +t[1] - 1, +t[2])
    var days = Math.round((due - today) / 86400000)
    if (days === 0) return "Due today"
    if (days === 1) return "Due tomorrow"
    if (days > 1 && days < 7) return "Due " + due.toLocaleDateString(Qt.locale(), "ddd")
    return "Due " + due.toLocaleDateString(Qt.locale(), "MMM d")
  }

  function short(text, n) { return text.length > n ? text.slice(0, n - 1) + "…" : text }

  function request(method, path, body, done) {
    if (!root.baseUrl) return
    var xhr = new XMLHttpRequest()
    xhr.onreadystatechange = function() {
      if (xhr.readyState !== XMLHttpRequest.DONE) return
      var ok = xhr.status >= 200 && xhr.status < 300
      var data = null
      try { data = JSON.parse(xhr.responseText) } catch (e) {}
      if (done) done(ok, data, xhr.status)
    }
    xhr.open(method, root.baseUrl + path)
    if (body !== null) xhr.setRequestHeader("Content-Type", "application/json")
    xhr.send(body !== null ? JSON.stringify(body) : null)
  }

  function query() {
    var q = []
    if (root.focusMode !== "all") q.push("area=" + root.focusMode)
    if (root.filter) q.push((root.filter.kind === "customer" ? "customer_id=" : "project_id=") + root.filter.id)
    return q.length ? "?" + q.join("&") : ""
  }

  function refresh() {
    if (!root.stateLoaded) return   // never fetch before the saved focus is known
    var requested = root.query()
    root.request("GET", "/api/bar" + requested, null, function(ok, data) {
      if (requested !== root.query()) return   // focus changed while this was in flight
      root.online = ok && data !== null
      if (root.online) root.st = data
    })
  }

  function setFocusMode(mode) {
    if (["work", "personal", "all"].indexOf(mode) < 0) return
    root.focusMode = mode
    root.filter = null
    root.st = null        // drop the other side's tasks right away
    root.saveState()
    root.refresh()
  }

  function setFilter(kind, id, name) {
    root.filter = kind ? { kind: kind, id: id, name: name } : null
    root.pickingFilter = false
    root.st = null
    root.saveState()
    root.refresh()
  }

  function saveState() {
    stateFile.setText(JSON.stringify({ focus: root.focusMode, filter: root.filter }, null, 2) + "\n")
  }

  function add() {
    var text = root.draft.trim()
    if (!text || root.busy) return
    root.busy = true
    var body = { text: text, source: "intake" }
    if (root.focusMode !== "all") body.area = root.focusMode
    if (root.filter && root.filter.kind === "project") body.project_id = root.filter.id
    root.request("POST", "/api/tasks/quick", body, function(ok, data) {
      root.busy = false
      if (ok) {
        root.draft = ""
        var where = data.today ? "today" : (data.project || (data.status === "inbox" ? "the inbox" : "to do"))
        root.flash = "Added to " + where
        root.refresh()
      } else {
        root.flash = data && data.detail ? String(data.detail) : "Couldn't reach todo"
      }
    })
  }

  function patch(id, body) {
    root.request("PATCH", "/api/tasks/" + id, body, function() { root.refresh() })
  }

  function openApp(path) {
    path = path || "/"
    path += (path.indexOf("?") >= 0 ? "&" : "?") + "focus=" + root.focusMode
    Quickshell.execDetached(["omarchy-launch-webapp", root.baseUrl + path])
    root.close()
  }

  implicitWidth: vertical ? barSize : chip.implicitWidth
  implicitHeight: vertical ? chip.implicitHeight : barSize

  // {"url": "http://192.168.1.47:7670"}
  FileView {
    path: Quickshell.env("HOME") + "/.config/todo/bar.json"
    watchChanges: true
    printErrors: false
    onFileChanged: reload()
    onLoaded: {
      try { root.baseUrl = String(JSON.parse(text()).url || "").replace(/\/$/, "") } catch (e) { root.baseUrl = "" }
      root.refresh()
    }
    onLoadFailed: { root.baseUrl = ""; root.online = false }
  }

  // {"focus": "work", "filter": {"kind": "project", "id": 3, "name": "Todo app"}}
  FileView {
    id: stateFile
    path: Quickshell.env("HOME") + "/.config/todo/bar-state.json"
    atomicWrites: true
    printErrors: false
    onLoaded: {
      try {
        var saved = JSON.parse(text())
        if (["work", "personal", "all"].indexOf(saved.focus) >= 0) root.focusMode = saved.focus
        root.filter = saved.filter || null
      } catch (e) {}
      root.stateLoaded = true
      root.refresh()
    }
    onLoadFailed: { root.stateLoaded = true; root.refresh() }
  }

  Timer {
    interval: 30000
    repeat: true
    running: true
    onTriggered: root.refresh()
  }

  Timer {
    id: flashTimer
    interval: 2500
    onTriggered: root.flash = ""
  }
  onFlashChanged: if (flash) flashTimer.restart()

  IpcHandler {
    target: "dev.todo"
    function toggle(): void { root.open() }
    // Open the panel with the add field focused (bound to SUPER+ALT+T).
    function add(text: string): void {
      root.panelOpen = true
      root.draft = text
      root.refresh()
      addField.forceActiveFocus()
    }
    // Switch focus from a keybinding or script: work | personal | all.
    function focus(mode: string): void { root.setFocusMode(mode) }
  }

  WidgetButton {
    id: chip
    anchors.centerIn: parent
    bar: root.bar
    text: root.focusGlyph + (root.vertical || !root.online ? ""
      : root.current ? "  " + root.short(root.current.title, 32)
      : root.tasks.length ? "  " + root.tasks.length + " today" : "")
    dimmed: !root.online || root.tasks.length === 0
    useActiveColor: false
    tooltipText: root.panelOpen ? "" : !root.online ? (root.baseUrl ? "Todo isn't reachable" : "Todo: run desktop/install.sh")
      : root.scopeName + "\n\n" + (root.tasks.length === 0 ? "Nothing on today" : "")
      + root.tasks.map(function(t) { return (t.status === "in_progress" ? "▶ " : "• ") + t.title }).join("\n")
        + ((root.counts.inbox || 0) > 0 ? "\n\n" + root.counts.inbox + " in the inbox" : "")
        + ((root.counts.review || 0) > 0 ? "\n" + root.counts.review + " proposal(s) to review" : "")

    onPressed: function(button) {
      if (button === Qt.MiddleButton) root.openApp("/")
      else root.open()
    }
  }

  KeyboardPanel {
    id: panel
    anchorItem: chip
    bar: root.bar
    owner: root
    open: root.panelOpen
    focusTarget: addField
    contentWidth: panel.fittedContentWidth(Style.space(380))
    contentHeight: panel.fittedContentHeight(column.implicitHeight, Style.space(640))

    PanelKeyCatcher {
      id: keys
      anchors.fill: parent
      blocked: addField.activeFocus
      onCloseRequested: root.close()

      Flickable {
        id: flick
        anchors.fill: parent
        contentWidth: width
        contentHeight: column.implicitHeight
        clip: true
        boundsBehavior: Flickable.StopAtBounds
        interactive: contentHeight > height
        ScrollBar.vertical: ScrollBar { policy: ScrollBar.AsNeeded }

        Column {
          id: column
          width: flick.width
          spacing: Style.space(10)

          // ------------------------------------------------ focus
          Row {
            visible: root.online
            width: parent.width
            spacing: Style.space(4)

            Repeater {
              model: [
                { mode: "work", label: "Work", glyph: "\u{f00d6}" },
                { mode: "personal", label: "Personal", glyph: "\u{f02dc}" },
                { mode: "all", label: "Everything", glyph: "\u{f0756}" }
              ]

              Button {
                required property var modelData
                text: modelData.label
                iconText: modelData.glyph
                selected: root.focusMode === modelData.mode
                bordered: true
                foreground: Color.popups.text
                fontSize: Style.font.bodySmall
                iconSize: Style.font.bodySmall
                horizontalPadding: Style.space(8)
                onClicked: root.setFocusMode(modelData.mode)
              }
            }
          }

          // ------------------------------------------------ filter
          Button {
            visible: root.online
            text: "Showing: " + root.scopeName + (root.pickingFilter ? "  \u{f0143}" : "  \u{f0140}")
            bordered: false
            foreground: Color.popups.text
            fontSize: Style.font.caption
            horizontalPadding: Style.space(2)
            tooltipText: "Narrow to one customer or project"
            onClicked: root.pickingFilter = !root.pickingFilter
          }

          Column {
            visible: root.online && root.pickingFilter
            width: parent.width
            spacing: Style.space(6)

            Flow {
              width: parent.width
              spacing: Style.space(4)
              Button {
                text: root.focusMode === "all" ? "Everything" : "All " + root.focusName.toLowerCase()
                selected: !root.filter
                bordered: true
                foreground: Color.popups.text
                fontSize: Style.font.caption
                horizontalPadding: Style.space(8)
                verticalPadding: Style.space(3)
                onClicked: root.setFilter(null)
              }
            }

            Text {
              visible: root.filterOptions.customers.length > 0
              text: "Customers"
              color: root.dimText
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
            }
            Flow {
              visible: root.filterOptions.customers.length > 0
              width: parent.width
              spacing: Style.space(4)
              Repeater {
                model: root.filterOptions.customers
                Button {
                  required property var modelData
                  text: modelData.name + (modelData.open ? "  " + modelData.open : "")
                  selected: !!root.filter && root.filter.kind === "customer" && root.filter.id === modelData.id
                  bordered: true
                  foreground: Color.popups.text
                  fontSize: Style.font.caption
                  horizontalPadding: Style.space(8)
                  verticalPadding: Style.space(3)
                  onClicked: root.setFilter("customer", modelData.id, modelData.name)
                }
              }
            }

            Text {
              visible: root.filterOptions.projects.length > 0
              text: "Projects"
              color: root.dimText
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
            }
            Flow {
              visible: root.filterOptions.projects.length > 0
              width: parent.width
              spacing: Style.space(4)
              Repeater {
                model: root.filterOptions.projects
                Button {
                  required property var modelData
                  text: modelData.name + (modelData.open ? "  " + modelData.open : "")
                  selected: !!root.filter && root.filter.kind === "project" && root.filter.id === modelData.id
                  bordered: true
                  foreground: Color.popups.text
                  fontSize: Style.font.caption
                  horizontalPadding: Style.space(8)
                  verticalPadding: Style.space(3)
                  onClicked: root.setFilter("project", modelData.id, modelData.name)
                }
              }
            }
          }

          TextField {
            id: addField
            width: parent.width
            placeholderText: root.filter && root.filter.kind === "project" ? "Add to " + root.filter.name + "…"
              : root.focusMode === "all" ? "Add a task…  #project !today ^fri"
              : "Add a " + root.focusName.toLowerCase() + " task…  #project !today ^fri"
            foreground: Color.popups.text
            font.family: root.fontFamily
            text: root.draft
            enabled: root.online
            onTextChanged: root.draft = text
            Keys.onReturnPressed: root.add()
            Keys.onEnterPressed: root.add()
            Keys.onEscapePressed: { if (root.draft) root.draft = ""; else root.close() }
          }

          Text {
            visible: text !== ""
            width: parent.width
            text: !root.online ? (root.baseUrl ? "Can't reach " + root.baseUrl : "Not set up: run desktop/install.sh") : root.flash
            color: root.dimText
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
          }

          Text {
            visible: root.online && root.meetings.length > 0
            text: "Meetings today"
            color: root.dimText
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
          }

          Column {
            visible: root.online && root.meetings.length > 0
            width: parent.width
            spacing: Style.space(2)

            Repeater {
              model: root.meetings

              Rectangle {
                id: meetingRow
                required property var modelData
                width: column.width
                height: meetingText.implicitHeight + Style.space(8)
                radius: Style.cornerRadius
                color: meetingMouse.containsMouse ? root.hoverFill : "transparent"

                MouseArea {
                  id: meetingMouse
                  anchors.fill: parent
                  hoverEnabled: true
                  cursorShape: Qt.PointingHandCursor
                  onClicked: root.openApp("/customers/" + meetingRow.modelData.customer_id + "?meeting=" + meetingRow.modelData.id)
                }

                Text {
                  id: meetingText
                  anchors.verticalCenter: parent.verticalCenter
                  x: Style.space(4)
                  width: parent.width - Style.space(8)
                  elide: Text.ElideRight
                  textFormat: Text.PlainText
                  text: (meetingRow.modelData.starts_at
                          ? new Date(meetingRow.modelData.starts_at).toLocaleTimeString(Qt.locale(), "h:mm AP") + "  "
                          : "")
                    + meetingRow.modelData.customer + " · " + meetingRow.modelData.title
                    + (meetingRow.modelData.prep ? "  ✓ prep" : "")
                  color: Color.popups.text
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.body
                }
              }
            }
          }

          Text {
            visible: root.online
            text: root.tasks.length ? "Today" : "Nothing on today"
            color: root.dimText
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
          }

          Column {
            visible: root.online && root.tasks.length > 0
            width: parent.width
            spacing: Style.space(2)

            Repeater {
              model: root.tasks

              Rectangle {
                id: row
                required property var modelData
                width: column.width
                height: rowContent.implicitHeight + Style.space(8)
                radius: Style.cornerRadius
                color: rowMouse.containsMouse ? root.hoverFill : "transparent"

                MouseArea {
                  id: rowMouse
                  anchors.fill: parent
                  hoverEnabled: true
                  cursorShape: Qt.PointingHandCursor
                  onClicked: root.openApp("/?task=" + row.modelData.id)
                }

                Row {
                  id: rowContent
                  anchors.verticalCenter: parent.verticalCenter
                  x: Style.space(2)
                  width: parent.width - Style.space(4)
                  spacing: Style.space(6)

                  Button {
                    id: doneButton
                    iconText: "\u{f0130}"
                    tooltipText: "Mark done"
                    foreground: Color.popups.text
                    iconSize: Style.font.body
                    horizontalPadding: Style.space(3)
                    verticalPadding: Style.space(2)
                    onClicked: root.patch(row.modelData.id, { status: "done" })
                  }

                  Column {
                    width: parent.width - doneButton.width - playButton.width - parent.spacing * 2
                    anchors.verticalCenter: parent.verticalCenter
                    Text {
                      width: parent.width
                      text: row.modelData.title
                      color: Color.popups.text
                      elide: Text.ElideRight
                      font.family: root.fontFamily
                      font.pixelSize: Style.font.body
                      font.bold: row.modelData.status === "in_progress"
                    }
                    Text {
                      visible: text !== ""
                      width: parent.width
                      text: [
                        row.modelData.status === "in_progress" ? "In progress" : "",
                        row.modelData.overdue ? "Overdue" : (row.modelData.due_on ? root.dueLabel(row.modelData.due_on) : ""),
                        row.modelData.project || ""
                      ].filter(function(s) { return s }).join(" · ")
                      color: row.modelData.overdue ? Color.urgent : root.dimText
                      elide: Text.ElideRight
                      font.family: root.fontFamily
                      font.pixelSize: Style.font.caption
                    }
                  }

                  Button {
                    id: playButton
                    iconText: row.modelData.status === "in_progress" ? "\u{f03e4}" : "\u{f040a}"
                    tooltipText: row.modelData.status === "in_progress" ? "Stop working on it" : "Start working on it"
                    selected: row.modelData.status === "in_progress"
                    foreground: Color.popups.text
                    iconSize: Style.font.body
                    horizontalPadding: Style.space(3)
                    verticalPadding: Style.space(2)
                    onClicked: root.patch(row.modelData.id, { status: row.modelData.status === "in_progress" ? "todo" : "in_progress" })
                  }
                }
              }
            }
          }

          Flow {
            visible: root.online
            width: parent.width
            spacing: Style.space(6)

            Button {
              id: openButton
              text: "Open todo"
              iconText: "\u{f03cc}"
              bordered: true
              foreground: Color.popups.text
              fontSize: Style.font.bodySmall
              onClicked: root.openApp("/")
            }
            Button {
              visible: (root.counts.review || 0) > 0
              text: "Review " + (root.counts.review || 0)
              selected: true
              bordered: true
              foreground: Color.popups.text
              fontSize: Style.font.bodySmall
              tooltipText: "Changes Claude proposed, waiting for you"
              onClicked: root.openApp("/review")
            }
            Button {
              visible: (root.counts.inbox || 0) > 0
              text: "Inbox " + (root.counts.inbox || 0)
              bordered: true
              foreground: Color.popups.text
              fontSize: Style.font.bodySmall
              onClicked: root.openApp("/inbox")
            }
            Text {
              visible: (root.counts.overdue || 0) > 0
              height: openButton.height
              verticalAlignment: Text.AlignVCenter
              text: root.counts.overdue + " overdue"
              color: root.dimText
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
            }
          }
        }
      }
    }
  }
}
