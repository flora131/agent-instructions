import { workflow } from "@bastani/workflows";

const options = { model: "nested-discovery-fixture/fixture", group: "reviewers" };
const grandchild = workflow({
	name: "discovery-grandchild",
	description: "Isolated completed/live reviewer discovery fixture.",
	outputs: {},
	inputs: {},
	run: async (ctx) => {
		await ctx.stage("completed-reviewer", options).prompt("fixture-complete");
		await ctx.stage("live-reviewer", options).prompt("fixture-hold");
		return {};
	},
});
const child = workflow({
	name: "discovery-child",
	description: "Isolated child boundary fixture.",
	outputs: {},
	inputs: {},
	run: async (ctx) => {
		await ctx.workflow(grandchild);
		return {};
	},
});
export default workflow({
	name: "nested-discovery-fixture",
	description: "Isolated root boundary fixture.",
	outputs: {},
	inputs: {},
	run: async (ctx) => {
		await ctx.workflow(child);
		return {};
	},
});
