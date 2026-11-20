// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Mock CHỈ DÙNG CHO TEST (forge test + testnet trial).
/// Mainnet Agent ID (0x60b9262456de011f7d15a54cdd8c48baaa8b022f) không có
/// trên testnet, nên mock này dùng để test local. KHÔNG deploy lên mainnet.
/// Chỉ owner mới được mint / gán handle.
contract MockAgentID {
    address public owner;
    mapping(address => uint256) public balances;
    mapping(address => string) public handles;

    event Minted(address indexed user, string handle);

    constructor() {
        owner = msg.sender;
    }

    function mint(address user, string calldata handle) external {
        require(msg.sender == owner, "not owner");
        require(balances[user] == 0, "already has id");
        balances[user] = 1;
        handles[user] = handle;
        emit Minted(user, handle);
    }

    function balanceOf(address user) external view returns (uint256) {
        return balances[user];
    }

    function handleOf(address user) external view returns (string memory) {
        return handles[user];
    }
}
