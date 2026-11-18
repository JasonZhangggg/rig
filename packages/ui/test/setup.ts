import { vi } from "vitest";

Element.prototype.scrollIntoView = () => {};
window.scrollTo = () => {};
// jsdom has no 2D canvas; returning null quietly is what it does anyway.
HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;

// The demo PC does different things by local hour, so a game can be running in the evening. Tests run as if it's 10 AM today, with the clock still moving.
const morning = new Date();
morning.setHours(10, 0, 0, 0);
vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
vi.setSystemTime(morning);
