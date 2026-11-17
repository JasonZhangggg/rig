Element.prototype.scrollIntoView = () => {};
window.scrollTo = () => {};
// jsdom has no 2D canvas; returning null quietly is what it does anyway.
HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
