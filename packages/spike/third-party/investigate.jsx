/*
 * E14-1 spike: third-party tools investigation.
 *
 * Run inside After Effects: File > Scripts > Run Script File..., pick this file,
 * then read the report it writes to the Desktop (ae-mcp-thirdparty-report.txt).
 *
 * What it collects:
 *   1. After Effects build and the open project.
 *   2. Installed CEP extensions (user and system).
 *   3. Preset folders shipped with After Effects.
 *   4. Folders that look like Animation Composer / Mister Horse / Mt. Mograph.
 *   5. Every layer in the active comp: name, type, markers, expressions, effects,
 *      so you can diff the report before and after you apply a preset by hand.
 *
 * ExtendScript ES3: var only, no arrow functions, no template strings, no native
 * JSON or Array helpers.
 *
 * API refs:
 *   https://ae-scripting.docsforadobe.dev/general/application/
 *   https://ae-scripting.docsforadobe.dev/item/compitem/
 *   https://ae-scripting.docsforadobe.dev/layer/layer/
 *   https://ae-scripting.docsforadobe.dev/property/property/
 *   https://ae-scripting.docsforadobe.dev/property/propertygroup/
 *   https://ae-scripting.docsforadobe.dev/other/markervalue/
 */
(function () {
  var lines = [];

  function line(text) {
    lines.push(text);
  }

  function heading(text) {
    line("");
    line("== " + text + " ==");
  }

  function listFolder(title, path) {
    heading(title);
    line("path: " + path);
    var folder = new Folder(path);
    if (!folder.exists) {
      line("(missing)");
      return;
    }
    var entries = folder.getFiles();
    for (var i = 0; i < entries.length; i++) {
      line((entries[i] instanceof Folder ? "[dir]  " : "[file] ") + entries[i].name);
    }
  }

  function listAeAppPresets() {
    heading("After Effects application presets");
    var apps = new Folder("/Applications").getFiles();
    for (var i = 0; i < apps.length; i++) {
      if (!(apps[i] instanceof Folder) || apps[i].name.indexOf("Adobe After Effects") !== 0) {
        continue;
      }
      line("app: " + apps[i].fsName);
      var presets = new Folder(apps[i].fsName + "/Presets");
      if (!presets.exists) {
        line("  (no Presets folder)");
        continue;
      }
      var groups = presets.getFiles();
      for (var j = 0; j < groups.length; j++) {
        line("  " + groups[j].name);
      }
    }
  }

  function scanForVendorFolders() {
    heading("Folders that look like third-party tool libraries");
    var roots = [
      Folder("~").fsName + "/Documents",
      Folder("~").fsName + "/Library/Application Support",
      Folder("~").fsName + "/Library/Application Support/Adobe",
      "/Applications",
    ];
    var keywords = ["animation composer", "mister horse", "mount mograph", "mr horse", "motion"];
    for (var r = 0; r < roots.length; r++) {
      var root = new Folder(roots[r]);
      if (!root.exists) {
        continue;
      }
      var children = root.getFiles();
      for (var i = 0; i < children.length; i++) {
        var lower = children[i].name.toLowerCase();
        for (var k = 0; k < keywords.length; k++) {
          if (lower.indexOf(keywords[k]) !== -1) {
            line(children[i].fsName);
            break;
          }
        }
      }
    }
  }

  function layerType(layer) {
    if (layer instanceof CameraLayer) return "camera";
    if (layer instanceof LightLayer) return "light";
    if (layer instanceof TextLayer) return "text";
    if (layer instanceof ShapeLayer) return "shape";
    if (layer instanceof AVLayer) return "av";
    return "other";
  }

  function dumpMarkers(layer) {
    var markers = layer.property("Marker");
    if (!markers) return;
    for (var i = 1; i <= markers.numKeys; i++) {
      var value = markers.keyValue(i);
      line("      marker @" + markers.keyTime(i).toFixed(3) + "s  dur " + value.duration + 's  "' + value.comment + '"');
    }
  }

  function dumpEffects(layer) {
    var parade = layer.property("ADBE Effect Parade");
    if (!parade) return;
    for (var i = 1; i <= parade.numProperties; i++) {
      var effect = parade.property(i);
      line("      effect " + effect.name + "  (" + effect.matchName + ")");
    }
  }

  function walkExpressions(group, prefix) {
    if (!group) return;
    for (var i = 1; i <= group.numProperties; i++) {
      var child = null;
      try {
        child = group.property(i);
      } catch (error) {
        continue;
      }
      if (!child) continue;
      var name = prefix + "/" + child.name;
      if (child.propertyType === PropertyType.PROPERTY) {
        if (child.expressionEnabled && child.expression) {
          line("      expr " + name + " = " + child.expression);
        }
      } else {
        walkExpressions(child, name);
      }
    }
  }

  function dumpExpressions(layer) {
    var seeds = ["ADBE Transform Group", "ADBE Effect Parade", "ADBE Mask Parade", "ADBE Text Properties"];
    for (var i = 0; i < seeds.length; i++) {
      var group = null;
      try {
        group = layer.property(seeds[i]);
      } catch (error) {
        group = null;
      }
      if (group) {
        walkExpressions(group, layer.name);
      }
    }
  }

  function dumpComp() {
    var comp = app.project ? app.project.activeItem : null;
    if (!comp || !(comp instanceof CompItem)) {
      heading("Active composition");
      line("(no comp open — open the comp with the preset-built layer first)");
      return;
    }
    heading("Active composition: " + comp.name);
    line("size " + comp.width + "x" + comp.height + "  duration " + comp.duration + "s  layers " + comp.numLayers);
    for (var i = 1; i <= comp.numLayers; i++) {
      var layer = comp.layer(i);
      line("  - layer " + i + ': "' + layer.name + '" [' + layerType(layer) + "] enabled=" + (layer.enabled ? "yes" : "no"));
      try {
        dumpMarkers(layer);
      } catch (e1) {}
      try {
        dumpEffects(layer);
      } catch (e2) {}
      try {
        dumpExpressions(layer);
      } catch (e3) {}
    }
  }

  heading("ae-mcp third-party investigation");
  line("generated: " + new Date().toString());
  line("after effects: " + app.version + " (build " + app.buildName + " " + app.buildNumber + ", " + app.isoLanguage + ")");
  line("project: " + (app.project && app.project.file ? app.project.file.fsName : "(unsaved)"));

  listFolder("CEP extensions (user)", Folder("~").fsName + "/Library/Application Support/Adobe/CEP/extensions");
  listFolder("CEP extensions (system)", "/Library/Application Support/Adobe/CEP/extensions");
  listAeAppPresets();
  scanForVendorFolders();
  dumpComp();

  var out = new File(Folder.desktop.fsName + "/ae-mcp-thirdparty-report.txt");
  out.encoding = "UTF-8";
  if (out.open("w")) {
    out.write(lines.join("\n"));
    out.close();
  }
  alert("ae-mcp third-party report written to\n" + out.fsName);
})();
