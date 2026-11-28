/** Names Rig gives a part it can't name, which add nothing beside the kind of part ("Power supply" under "Power supply"). */
const PLACEHOLDER = /^(Your case|Power supply|Case fans|Laptop fans|Battery)$/;

export const isPlaceholderName = (name: string) => PLACEHOLDER.test(name);
