"use strict";

const { Container, value } = require('minimalist-async-di');

exports.WiringBuilder = class WiringBuilder {

	constructor(wiring) {
		if (wiring && !Wiring.isWiring(wiring)) {
			throw new TypeError("invalid wiring");
		}

		/*
		 * Take a copy of the passed wiring so we don't mutate the original.
		 */
		this._wiring = wiring ? new wiring.constructor(wiring) : new Wiring();
	}

	adjustBaseWiring(wiringAdjuster) {
		if (typeof wiringAdjuster !== 'function') {
			throw new TypeError("invalid adjuster");
		}

		this._wiring._adjustBaseWiring(wiringAdjuster);

		return this;
	}

	adjustContainer(containerType, containerAdjuster) {
		if (!Wiring.isValidContainerType(containerType)) {
			throw new TypeError("invalid container type");
		}

		if (typeof containerAdjuster !== 'function') {
			throw new TypeError("invalid adjuster");
		}

		this._wiring._adjustContainer(containerType, containerAdjuster);

		return this;
	}

	adjustWiringAfter(containerType, wiringAdjuster) {
		if (!Wiring.isValidContainerType(containerType)) {
			throw new TypeError("invalid container type");
		}

		if (typeof wiringAdjuster !== 'function') {
			throw new TypeError("invalid adjuster");
		}

		this._wiring._adjustWiringAfter(containerType, wiringAdjuster);

		return this;
	}

	addWiring(wiring) {
		if (!Wiring.isWiring(wiring)) {
			throw new TypeError("invalid wiring");
		}

		this._wiring._addWiring(wiring);

		return this;
	}

	build() {
		/*
		 * Return a copy of the wiring so any further use of this builder doesn't mutate it.
		 */
		return new this._wiring.constructor(this._wiring);
	}

};

/*
 * Wiring has two distinct phases: a definition phase where wiring is added and adjusters are
 * registered, and a creation phase, where containers are created. Both phases mutate the
 * wiring object as they progress. During the definition phase, the wiring is private to the
 * WiringBuilder, and mutated by it. Then, between the two phases there is a 'public' and
 * conceptually immutable version of the wiring (returned from the WiringBuilder::build
 * method). This 'public' wiring can be imported into another WiringBuilder (a definition-phase
 * copy will be made), added to other definition-phase wiring (via WiringBuilder::addWiring;
 * its content will be copied into the destination wiring), or added to creation-phase wiring
 * (via a previously added wiring adjuster; its content will be copied into "supplied wiring",
 * held by the destination wiring). Alternatively, it can itself progress to creation phase (by
 * calling Wiring::createContainer, or a factory returned by Wiring::createContainerFactory;
 * a creation-phase copy will be made and placed in the created container). During the creation
 * phase, the wiring is private to the container whose creation transitioned it to that phase,
 * and mutation occurs via wiring adjusters being called.
 */
class Wiring {

	constructor(wiring) {
		/*
		 * Lists of container adjusters keyed by container type, which is dot separated to
		 * establish a hierarchy, with the empty string being the conceptual root (so mostly
		 * when accessing this, a dot is prepended to the user-provided container type).
		 * Each list is complete: when it is first created, any ancestor's adjusters are used
		 * to initialise the list, and future adjustments are made to all descendants.
		 *
		 * The container adjuster lists are iterated to create containers. Each adjuster
		 * can be a true container adjuster (added using _adjustContainer), or can be a wiring
		 * adjuster (added with _adjustBaseWiring or _adjustWiringAfter). In the case of a
		 * wiring adjuster, it is not actually called while iterating the container adjusters;
		 * rather, it stands for its supplied wiring, if and only if it has been called as
		 * determined by its position in _wiringAdjusters.
		 */
		this._containerAdjusters = {};

		/*
		 * Lists of wiring adjusters keyed by container type, which is dot separated to
		 * establish a hierarchy, but with the empty string used to represent base wiring
		 * adjusters as a distinct top-level value (not the root; no dots are prepended to
		 * user-provided container types when accessing this).
		 */
		this._wiringAdjusters = {};

		/*
		 * Map whose keys include all wiring adjusters used by this wiring and any supplied
		 * wiring. A container adjuster is actually a wiring adjuster if and only if it appears
		 * here. The value is initialised to null, but becomes a Wiring object containing the
		 * wiring supplied by the adjuster when it is called.
		 */
		this._wiringSuppliedByWiringAdjusters = wiring ?
				new Map(wiring._wiringSuppliedByWiringAdjusters) : new Map();

		if (wiring) {
			Object.entries(wiring._containerAdjusters)
			.forEach(([containerType, containerAdjusters]) => {
				this._containerAdjusters[containerType] = containerAdjusters.slice();
			});

			Object.entries(wiring._wiringAdjusters)
			.forEach(([containerType, wiringAdjusters]) => {
				this._wiringAdjusters[containerType] = wiringAdjusters.slice();
			});
		}
	}

	async createContainer(containerType, ...args) {
		if (!Wiring.isValidContainerType(containerType)) {
			throw new TypeError("invalid container type");
		}

		/*
		 * Make a clone of the wiring so wiring instantiated while building this container
		 * (using particular arguments) does not impact future containers. This cloned wiring
		 * is 'private'; the only reference to it will be in the created container, and it
		 * should not be leaked, but only used to create subsequent containers.
		 */
		const wiring = new this.constructor(this);

		return await wiring._createContainer(containerType, ...args);
	}

	async createContainerFactory(containerType, ...factoryArgs) {
		if (!Wiring.isValidContainerType(containerType)) {
			throw new TypeError("invalid container type");
		}

		/*
		 * See comment at createContainer() regarding this cloning.
		 */
		const wiring = new this.constructor(this);

		return await wiring._createContainerFactory(containerType, ...factoryArgs);
	}

	_adjustBaseWiring(wiringAdjuster) {
		this._adjustWiringAfter('', wiringAdjuster);
	}

	_adjustContainer(containerType, containerAdjuster) {
		this._addAdjuster(this._containerAdjusters, `.${containerType}`, containerAdjuster);

		this._ensureContainerTypeExists(this._wiringAdjusters, containerType);
	}

	_adjustWiringAfter(containerType, wiringAdjuster) {
		this._addAdjuster(this._wiringAdjusters, containerType, wiringAdjuster);

		if (containerType !== '') {
			this._ensureContainerTypeExists(this._containerAdjusters, `.${containerType}`);
		}

		/*
		 * Add to all container types.
		 */
		this._addAdjuster(this._containerAdjusters, '', wiringAdjuster);

		this._ensureSuppliedWiringKeyExists(wiringAdjuster);
	}

	_addWiring(wiring) {
		this._addAdjusters(this._containerAdjusters, wiring._containerAdjusters);
		this._addAdjusters(this._wiringAdjusters, wiring._wiringAdjusters);

		/*
		 * Only 'public' wiring which has not had any containers created yet should be
		 * passed here, so we expect suppliedWiring to always be null, but we still
		 * need to know which adjusters are wiring adjusters, so we want to set them.
		 */
		this._addSuppliedWiring(wiring);
	}

	_addAdjuster(adjusterCollection, containerType, adjuster) {
		const adjusters = [adjuster];
		this._ensureContainerTypeExists(adjusterCollection, containerType);
		this._pushAdjusters(adjusterCollection[containerType], adjusters);
		this._pushAdjustersIntoDescendants(adjusterCollection, containerType, adjusters);
	}

	_addAdjusters(adjusterCollection, sourceCollection) {
		Object.entries(sourceCollection)
		.forEach(([containerType, containerAdjusters]) => {
			this._ensureContainerTypeExists(adjusterCollection, containerType);
			this._pushAdjusters(adjusterCollection[containerType],
					containerAdjusters);
			this._pushAdjustersIntoUnknownDescendants(adjusterCollection, containerType,
					containerAdjusters, sourceCollection);
		});
	}

	_addSuppliedWiring(wiring) {
		wiring._wiringSuppliedByWiringAdjusters.forEach((suppliedWiring, wiringAdjuster) => {
			if (!this._wiringSuppliedByWiringAdjusters.has(wiringAdjuster)) {
				this._wiringSuppliedByWiringAdjusters.set(wiringAdjuster, suppliedWiring);
			}
		});
	}

	_ensureContainerTypeExists(adjusterCollection, containerType) {
		if (!adjusterCollection[containerType]) {
			adjusterCollection[containerType] =
					this._getAncestorAdjusters(adjusterCollection, containerType);
		}
	}

	_getAncestorAdjusters(adjusterCollection, containerType) {
		const ancestorComponents = containerType.split('.');

		while (ancestorComponents.length > 1) {
			ancestorComponents.pop();

			const ancestor = ancestorComponents.join('.');
			if (adjusterCollection[ancestor]) {
				return adjusterCollection[ancestor].slice();
			}
		}

		return [];
	}

	_pushAdjusters(adjusterList, adjusters) {
		adjusters.forEach((adjuster) => {
			adjusterList.push(adjuster);
		});
	}

	_pushAdjustersIntoDescendants(adjusterCollection, containerType, adjusters) {
		Object.entries(adjusterCollection).forEach(([maybeDescendentType, adjusterList]) => {
			if (maybeDescendentType.startsWith(`${containerType}.`)) {
				this._pushAdjusters(adjusterList, adjusters);
			}
		});
	}

	_pushAdjustersIntoUnknownDescendants(adjusterCollection, containerType, adjusters,
			referenceCollection) {
		Object.entries(adjusterCollection).forEach(([maybeDescendentType, adjusterList]) => {
			if (maybeDescendentType.startsWith(`${containerType}.`)) {
				if (!referenceCollection[maybeDescendentType]) {
					this._pushAdjusters(adjusterList, adjusters);
				}
			}
		});
	}

	_ensureSuppliedWiringKeyExists(wiringAdjuster) {
		if (!this._wiringSuppliedByWiringAdjusters.has(wiringAdjuster)) {
			this._wiringSuppliedByWiringAdjusters.set(wiringAdjuster, null);
		}
	}

	async _createContainer(containerType, ...args) {
		await this._gatherWiringSuppliedByWiringAdjusters('');

		if (!this._containerAdjusters[`.${containerType}`]) {
			throw new RangeError(`container type '${containerType}' unknown`);
		}

		const container = new Container();

		container.register('wiring', value(this));

		const containerAdjusters = this._getFlattenedContainerAdjusters(
				this._containerAdjusters, `.${containerType}`);

		const appliedContainerAdjusters = new Set();
		for (const containerAdjuster of containerAdjusters) {
			if (!appliedContainerAdjusters.has(containerAdjuster)) {
				appliedContainerAdjusters.add(containerAdjuster);
				await containerAdjuster(container, ...args);
			}
		}

		await this._gatherWiringSuppliedByWiringAdjusters(containerType, container);

		return container;
	}

	async _createContainerFactory(containerType, ...factoryArgs) {
		await this._gatherWiringSuppliedByWiringAdjusters('');

		if (!this._containerAdjusters[`.${containerType}`]) {
			throw new RangeError(`container type '${containerType}' unknown`);
		}

		return async (...callerArgs) => {
			/*
			 * See comment at createContainer() regarding this cloning.
			 */
			const wiring = new this.constructor(this);

			return await wiring._createContainer(containerType, ...factoryArgs, ...callerArgs);
		};
	}

	_getFlattenedContainerAdjusters(adjusterCollection, containerType) {
		const flattenedContainerAdjusters = [];

		adjusterCollection[containerType].forEach((adjuster) => {
			const suppliedWiring =
					this._wiringSuppliedByWiringAdjusters.get(adjuster);

			if (typeof suppliedWiring === 'undefined') {
				/*
				 * It's truly a container adjuster.
				 */
				return flattenedContainerAdjusters.push(adjuster);
			}

			if (suppliedWiring === null) {
				/*
				 * It's a wiring adjuster which hasn't been called yet.
				 */

				return;
			}

			if (suppliedWiring._containerAdjusters[containerType]) {
				const suppliedContainerAdjusters = this._getFlattenedContainerAdjusters(
						suppliedWiring._containerAdjusters, containerType);

				this._pushAdjusters(flattenedContainerAdjusters,
						suppliedContainerAdjusters);
			}
		});

		return flattenedContainerAdjusters;
	}

	async _gatherWiringSuppliedByWiringAdjusters(containerType, arg) {
		if (!this._wiringAdjusters[containerType]) {
			return;
		}

		/*
		 * We don't want to call the same adjusters again, so we consume them, and running an
		 * adjuster may add more, so we allow the array to potentially mutate as we consume it.
		 */
		let wiringAdjuster;
		while ((wiringAdjuster = this._wiringAdjusters[containerType].shift())) {
			const alreadySuppliedWiring =
					this._wiringSuppliedByWiringAdjusters.get(wiringAdjuster);
			if (alreadySuppliedWiring) {
				continue;
			}

			const suppliedWiring = new Wiring();
			this._wiringSuppliedByWiringAdjusters.set(wiringAdjuster, suppliedWiring);

			const addWiring = (wiringToAdd) => {
				if (!Wiring.isWiring(wiringToAdd)) {
					throw new TypeError("invalid wiring passed to wiring adjuster callback");
				}

				/*
				 * Container adjusters need to be in the supplied wiring, from which they are
				 * flattened into the lists of adjusters used to create containers.
				 */
				this._addAdjusters(suppliedWiring._containerAdjusters,
						wiringToAdd._containerAdjusters);

				/*
				 * Wiring adjusters, however, need to be here to have their wiring gathered at
				 * the proper time (perhaps a later iteration of this loop, or perhaps after
				 * a(nother) container creation).
				 */
				this._addAdjusters(this._wiringAdjusters, wiringToAdd._wiringAdjusters);

				/*
				 * Only 'public' wiring which has not had any containers created yet should be
				 * passed here, so we expect suppliedWiring to always be null, but we still
				 * need to know which adjusters are wiring adjusters, so we want to set them.
				 */
				this._addSuppliedWiring(wiringToAdd);
			};

			await wiringAdjuster(addWiring, arg);

			/*
			 * Synchronise container types between the supplied wiring and this wiring.
			 */
			Object.keys(suppliedWiring._containerAdjusters).forEach((containerType) => {
				this._ensureContainerTypeExists(this._containerAdjusters,
						containerType);
			});
			Object.keys(this._containerAdjusters).forEach((containerType) => {
				this._ensureContainerTypeExists(suppliedWiring._containerAdjusters,
						containerType);
			});
		}
	}

}

Wiring.isWiring = function (wiring) {
	return typeof wiring === 'object' &&
			'_containerAdjusters' in wiring &&
			'_wiringAdjusters' in wiring &&
			'_wiringSuppliedByWiringAdjusters' in wiring;
};

Wiring.isValidContainerType = function (containerType) {
	return typeof containerType === 'string' &&
			containerType !== '' &&
			containerType[0] !== '.' &&
			containerType.slice(-1) !== '.';
};

exports.Wiring = Wiring;
