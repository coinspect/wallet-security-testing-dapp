import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import solc from 'solc';

test('test duplicate compiles with the expected ERC-20 interface and no mint or admin methods', () => {
    const path = 'contracts/WSRDuplicateToken.sol';
    const content = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
    const output = JSON.parse(solc.compile(JSON.stringify({
        language: 'Solidity',
        sources: { [path]: { content } },
        settings: {
            optimizer: { enabled: true, runs: 200 },
            evmVersion: 'paris',
            outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
        },
    })));
    assert.deepEqual((output.errors ?? []).filter((error) => error.severity === 'error'), []);
    const contract = output.contracts[path].WSRDuplicateToken;
    assert.ok(contract.evm.bytecode.object.length > 0);
    assert.deepEqual(contract.abi.find((entry) => entry.type === 'constructor').inputs, []);
    assert.deepEqual(contract.abi.filter((entry) => entry.type === 'function').map((entry) => entry.name).sort(), [
        'METADATA_SOURCE', 'allowance', 'approve', 'balanceOf', 'decimals', 'name', 'symbol', 'totalSupply', 'transfer', 'transferFrom',
    ].sort());
    assert.match(content, /block.chainid == 137/);
    for (const field of ['name', 'symbol', 'decimals']) {
        assert.ok(content.includes(`${field} = source.${field}();`));
    }
    assert.match(content, /totalSupply = 0/);
});
