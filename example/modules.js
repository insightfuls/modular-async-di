"use strict";

exports.parseCommandLine = function(cliArguments) {
	return {
		useColour: cliArguments.includes("--colour") || cliArguments.includes("--color"),
		names: cliArguments.filter((cliArgument) => !cliArgument.startsWith('-'))
	};
};

exports.App = class App {
	constructor(config, createRequestContainer) {
		this.config = config;
		this.createRequestContainer = createRequestContainer;
	}
	async run() {
		for (const name of this.config.names) {
			const container = await this.createRequestContainer(name);
			const greeter = await container.get('greeter');
			await greeter.greet();
		}
	}
};

exports.Greeter = class Greeter {
	constructor(writeLine, emphasise, name) {
		this.writeLine = writeLine;
		this.emphasise = emphasise;
		this.name = name;
	}
	async greet() {
		this.writeLine("Hello, " + this.emphasise(this.name) + "!");
	}
};

