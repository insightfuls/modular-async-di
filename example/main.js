"use strict";

require('./wiring') // or require('./unmodularised-wiring')
.createBootContainer({
	emphasisColour: "magenta"
})
.then((container) => container.get('app'))
.then((app) => app.run())
.catch(console.error);
