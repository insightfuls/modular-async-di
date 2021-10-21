"use strict";

const expect = require('chai').expect;
const { StructuredWiringBuilder } = require('..');
const builder = new StructuredWiringBuilder(require('./wiring'));

let inputArgs;
let outputMessages;

builder.adjustBootContainer(async function (container) {
	const { register, replacement, factory } = container;

	register(replacement('cliArguments'), factory(() => inputArgs));
});

builder.adjustAppContainer(async function (container) {
	const { register, replacement, value } = container;

	register(replacement('console'), value({
		log(message) { outputMessages.push(message); }
	}));
});

const wiring = builder.build();

describe("hello, world!", function () {

	beforeEach(function () {
		inputArgs = [];
		outputMessages = [];
	});

	it("works correctly without colour", async function () {
		inputArgs = ["John", "Howard"];

		const container = await wiring.createBootContainer({})
		const app = await container.get('app');
		await app.run();

		expect(outputMessages).to.deep.equal([
			"Hello, John!",
			"Hello, Howard!"
		]);
	});

});
