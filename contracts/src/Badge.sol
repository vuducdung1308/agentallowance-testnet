// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title AgentAllowance Badge
/// @notice ERC-721 soulbound tối giản, TỰ VIẾT không phụ thuộc ngoài.
/// - 1 ví tối đa 1 badge, tier theo band điểm đã xác nhận mới nhất:
///   Bronze 50–69, Silver 70–89, Gold 90–100; dưới 50 không mint mới.
/// - Điểm tụt dưới 50 thì GIỮ NGUYÊN tier cũ, không đốt badge.
/// - Không chuyển nhượng: transferFrom / safeTransferFrom / approve luôn revert.
/// - Chỉ AgentAllowance (gọi từ attestScore) hoặc owner mới được mint/đổi tier.
/// - Không payable, không proxy, không selfdestruct. Không có giá trị tiền tệ.
contract Badge {
    // --- Errors ---
    error NotAuthorized();
    error Soulbound();
    error NotOwner();
    error ZeroAddress();

    // --- Events ---
    event BadgeMinted(address indexed agent, uint256 indexed tokenId, uint8 tier);
    event BadgeTierUpdated(address indexed agent, uint256 indexed tokenId, uint8 oldTier, uint8 newTier);
    event AgentAllowanceChanged(address indexed oldAddress, address indexed newAddress);

    // --- Metadata ---
    string public name = "AgentAllowance Badge";
    string public symbol = "AAB";

    // --- Roles ---
    address public owner; // Safe 2-of-3 (dùng lại của SafeStreak)
    address public agentAllowance; // contract AgentAllowance được phép gọi mintOrUpdateTier

    // --- State ---
    uint256 public nextTokenId; // tokenId bắt đầu từ 1 (0 = chưa có badge)
    mapping(address => uint256) private _tokenIdOf;
    mapping(uint256 => address) private _ownerOf;
    mapping(address => uint8) private _tierOf; // 0 = chưa có badge, 1 = Bronze, 2 = Silver, 3 = Gold
    mapping(address => uint256) private _balance;

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address owner_) {
        if (owner_ == address(0)) revert ZeroAddress();
        owner = owner_;
    }

    /// @notice Band tier theo điểm (SPEC §3.8). 0 = chưa đủ band để mint.
    function tierForScore(uint256 score) public pure returns (uint8) {
        if (score >= 90) return 3; // Gold
        if (score >= 70) return 2; // Silver
        if (score >= 50) return 1; // Bronze
        return 0;
    }

    /// @notice Mint lần đầu nếu ví chưa có và score >= 50; đổi tier nếu band thay đổi.
    /// Điểm < 50: không mint mới; ví đã có badge thì giữ nguyên tier cũ (không đốt).
    /// Chỉ AgentAllowance hoặc owner được gọi (owner dùng cho sửa chữa thủ công).
    function mintOrUpdateTier(address agent, uint256 score) external {
        if (msg.sender != agentAllowance && msg.sender != owner) revert NotAuthorized();
        if (agent == address(0)) revert ZeroAddress();
        uint8 newTier = tierForScore(score);
        uint256 tokenId = _tokenIdOf[agent];
        if (tokenId == 0) {
            if (newTier == 0) return; // dưới 50: không mint mới
            tokenId = ++nextTokenId;
            _tokenIdOf[agent] = tokenId;
            _ownerOf[tokenId] = agent;
            _tierOf[agent] = newTier;
            _balance[agent] = 1;
            emit BadgeMinted(agent, tokenId, newTier);
        } else {
            uint8 oldTier = _tierOf[agent];
            if (newTier == 0 || newTier == oldTier) return; // dưới 50: giữ tier cũ; cùng band: không đổi
            _tierOf[agent] = newTier;
            emit BadgeTierUpdated(agent, tokenId, oldTier, newTier);
        }
    }

    /// @notice Gán/đổi địa chỉ contract AgentAllowance được phép gọi mintOrUpdateTier.
    function setAgentAllowance(address newAgentAllowance) external onlyOwner {
        if (newAgentAllowance == address(0)) revert ZeroAddress();
        emit AgentAllowanceChanged(agentAllowance, newAgentAllowance);
        agentAllowance = newAgentAllowance;
    }

    /// @notice Tier của ví: 0 = chưa có badge, 1 = Bronze, 2 = Silver, 3 = Gold.
    function tierOf(address agent) external view returns (uint8) {
        return _tierOf[agent];
    }

    /// @notice tokenId của badge ví này, 0 nếu chưa có.
    function tokenIdOf(address agent) external view returns (uint256) {
        return _tokenIdOf[agent];
    }

    // --- ERC-721 tối giản (chỉ đọc + soulbound) ---

    function balanceOf(address account) external view returns (uint256) {
        if (account == address(0)) revert ZeroAddress();
        return _balance[account];
    }

    function ownerOf(uint256 tokenId) external view returns (address) {
        address o = _ownerOf[tokenId];
        if (o == address(0)) revert ZeroAddress();
        return o;
    }

    function tokenURI(uint256 tokenId) external view returns (string memory) {
        if (_ownerOf[tokenId] == address(0)) revert ZeroAddress();
        return "";
    }

    function getApproved(uint256) external pure returns (address) {
        return address(0);
    }

    function isApprovedForAll(address, address) external pure returns (bool) {
        return false;
    }

    // Soulbound: mọi đường chuyển nhượng / ủy quyền đều revert.
    function approve(address, uint256) external pure {
        revert Soulbound();
    }

    function setApprovalForAll(address, bool) external pure {
        revert Soulbound();
    }

    function transferFrom(address, address, uint256) external pure {
        revert Soulbound();
    }

    function safeTransferFrom(address, address, uint256) external pure {
        revert Soulbound();
    }

    function safeTransferFrom(address, address, uint256, bytes calldata) external pure {
        revert Soulbound();
    }
}
