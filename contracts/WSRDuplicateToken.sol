// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

interface IERC20MetadataSource {
    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
    function decimals() external view returns (uint8);
}

/// @notice Test duplicate for approval-dialog comparisons. Not USDC or a stablecoin.
contract WSRDuplicateToken {
    address public constant METADATA_SOURCE = 0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174;
    string public name;
    string public symbol;
    uint8 public decimals;
    uint256 public constant totalSupply = 0;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor() {
        require(block.chainid == 137, "Polygon only");
        IERC20MetadataSource source = IERC20MetadataSource(METADATA_SOURCE);
        name = source.name();
        symbol = source.symbol();
        decimals = source.decimals();
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
        }
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(from != address(0) && to != address(0), "zero address");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}
