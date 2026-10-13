export const EIP1271_MAGIC_VALUE = "0x1626ba7e";

export const isEip1271MagicValue = (value) =>
    typeof value === "string" &&
    value.slice(0, EIP1271_MAGIC_VALUE.length).toLowerCase() === EIP1271_MAGIC_VALUE;
