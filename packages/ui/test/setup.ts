import { vi } from "vitest";
import { DemoClient } from "@rig/core/demo";

Element.prototype.scrollIntoView = () => {};
window.scrollTo = () => {};
// jsdom has no 2D canvas; returning null quietly is what it does anyway.
HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;

// The demo PC does different things by local hour and weekday: a game can be running in the evening, and its month of
// events is laid out from its last Wednesday evening. Tests run as if it's 10 AM on the latest Thursday, with the clock still moving.
const morning = new Date();
morning.setHours(10, 0, 0, 0);
while (morning.getDay() !== 4) morning.setDate(morning.getDate() - 1);
vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
vi.setSystemTime(morning);

// The demo pretends approval steps take a moment, for the website. Tests don't wait for it.
DemoClient.pace = 0;
