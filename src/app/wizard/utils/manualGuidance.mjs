// Presentation only. Every instruction, expected observation, capture and link
// still comes from its original wizard.json row, in the original order.
export const MANUAL_GUIDANCE = {
    "WSR-PHYS-002~Browser.v1": {
        objective: "Check which password rules the wallet enforces.",
        titles: ["Open password settings", "Try weak passwords", "Check the stated rules", "Record your attempts"],
    },
    "WSR-PHYS-002~Mobile.v1": {
        objective: "Check biometric unlock, weak PINs and protection against repeated attempts.",
        titles: ["Check biometric unlock", "Try the weak PIN", "Enter wrong PINs", "Record the rate limiting"],
    },
    "WSR-PHYS-004.v1": {
        objective: "Check whether you can lock the wallet immediately.",
        titles: ["Find the lock control", "Lock the wallet"],
    },
    "WSR-PHYS-006~Browser.v1": {
        objective: "Check when the wallet locks itself after inactivity.",
        titles: ["Find auto-lock settings", "Record the timeout", "Check idle locking"],
    },
    "WSR-PHYS-006~Mobile.v1": {
        objective: "Check automatic locking after inactivity, backgrounding and device lock.",
        titles: ["Check the timer", "Background and reopen", "Lock and reopen the device", "Check idle locking"],
    },
    "WSR-PHYS-005.v1": {
        objective: "Check whether the wallet authenticates you before revealing a secret.",
        titles: ["Open the reveal screen", "Check authentication", "Record the authentication method"],
    },
    "WSR-PHYS-003.v1": {
        objective: "Check whether the wallet explains the risk before revealing a secret.",
        titles: ["Open the reveal screen", "Look for a warning", "Assess the warning"],
    },
    "WSR-PHYS-001.v1": {
        objective: "Check how the wallet handles copying and capturing a secret.",
        titles: ["Open the seed screen", "Check the copy warning", "Check clipboard clearing", "Test screenshots on mobile"],
    },
    "WSR-PERM-005.v1": {
        objective: "Check whether the wallet helps you inspect and revoke token approvals.",
        titles: ["Find approval management", "Inspect the revoke option", "Record any external tool"],
    },
    "WSR-THRE-007.v1": {
        objective: "Check whether spam tokens and NFTs are hidden by default.",
        titles: ["Open the default asset view", "Identify spam", "Check default filtering", "Record the spam contract"],
    },
    "WSR-THRE-006.v1": {
        objective: "Check whether the wallet shows the full dApp origin in connection requests.",
        titles: ["Open each dApp", "Inspect the full origin", "Reject each connection"],
    },
};
