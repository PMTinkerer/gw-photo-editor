import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const html = readFileSync(new URL("../../admin/index.html", import.meta.url), "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

test("dashboard renders user-controlled values as text in every panel", () => {
  const panels = new Map();
  function element(id) {
    if (!panels.has(id)) panels.set(id, {
      addEventListener() {}, querySelector() { return this; }, innerHTML: "",
    });
    return panels.get(id);
  }
  const document = {
    getElementById: element,
    createElement() {
      return { set textContent(value) {
        this.innerHTML = value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
      } };
    },
  };
  const context = vm.createContext({ document, sessionStorage: { getItem: () => null } });
  vm.runInContext(script, context);
  const marker = "<b>record</b>";
  context.renderStats({total_cost: 1, avg_score: marker});
  context.renderScoreChart({1: 2, [marker]: null});
  context.renderIssues([{issue: marker, count: marker}]);
  context.renderSessions([{property_name: marker, iterations: marker, avg_score: marker}]);
  for (const panel of ["statsGrid", "scoreChart", "issuesTable", "sessionsTable"]) {
    assert.ok(!element(panel).innerHTML.includes(marker), panel + " inserted markup");
  }
  assert.match(element("scoreChart").innerHTML, /class="count">2</);
  assert.match(element("sessionsTable").innerHTML, /&lt;b&gt;record/);
});
