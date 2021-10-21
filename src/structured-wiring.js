"use strict";

const { WiringBuilder, Wiring } = require('./wiring');

exports.StructuredWiringBuilder = class StructuredWiringBuilder extends WiringBuilder {

	constructor(wiring) {
		super(wiring ? wiring : new StructuredWiring());

		this.adjustBootContainer(_populateBootContainer);
		this.adjustAppContainer(_populateAppContainer);
	}

	adjustBootContainer(adjuster) {
		return this.adjustContainer('Boot', adjuster);
	}

	adjustWiringAfterBoot(adjuster) {
		return this.adjustWiringAfter('Boot', adjuster);
	}

	adjustAppContainer(adjuster) {
		return this.adjustContainer('App', adjuster);
	}

	adjustScopeContainer(scopeTypeOrAdjuster, maybeAdjuster) {
		if (typeof scopeTypeOrAdjuster === 'string') {
			if (!StructuredWiring.isValidScopeType(scopeTypeOrAdjuster)) {
				throw new TypeError("invalid scope type");
			}

			return this.adjustContainer(`Scope.${scopeTypeOrAdjuster}`, maybeAdjuster);
		}

		return this.adjustContainer('Scope', scopeTypeOrAdjuster);
	}

};

class StructuredWiring extends Wiring {

	createBootContainer(bootOptions) {
		return this.createContainer('Boot', bootOptions);
	}

	async createAppContainer(bootOptions) {
		/*
		 * Do not delegate to this.createBootContainer() so both it and this method can be
		 * overridden with a different input argument.
		 */
		const bootContainer = await this.createContainer('Boot', bootOptions);

		return await bootContainer.get('appContainer');
	}

	createScopeContainer(scopeType, ...args) {
		return this.createContainer(`Scope.${scopeType}`, ...args);
	}

	createScopeContainerFactory(scopeType, ...args) {
		return this.createContainerFactory(`Scope.${scopeType}`, ...args);
	}

}

Wiring.isValidScopeType = function (scopeType) {
	return typeof scopeType === 'string' &&
			scopeType !== '' &&
			!scopeType.includes('.');
};

exports.StructuredWiring = StructuredWiring;

function _populateBootContainer(container) {
	const { register, factory, value, bean } = container;

	register('appContainer', factory('wiring.createContainer'),
			value('App'), value(container));
	register('app', bean('appContainer.app'));
}

function _populateAppContainer(container, bootContainer) {
	const { register, value } = container;

	register('bootContainer', value(bootContainer));
}

