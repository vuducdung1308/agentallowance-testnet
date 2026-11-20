// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title AgentAllowance
/// @notice Lưu Hygiene Score đã xác nhận (verifier ký EIP-712) cho ví Agent ID trên BSC.
/// - Điểm chỉ ghi on-chain khi có chữ ký của verifier hiện tại, đúng domain EIP-712,
///   đúng nonce theo ví, deadline tối đa 15 phút.
/// - Badge soulbound được mint / đổi tier TỰ ĐỘNG trong attestScore (không claim riêng).
/// - Không proxy, không payable (không receive/fallback), không transfer/transferFrom.
/// - Owner là Safe 2-of-3 dùng lại của SafeStreak.
/// @dev Chain triển khai: BNB Smart Chain (chainId 56). Agent ID:
///      0x60b9262456de011f7d15a54cdd8c48baaa8b022f (ERC-721, balanceOf > 0 = có Agent ID).
interface IAgentID {
    function balanceOf(address account) external view returns (uint256);
    function handleOf(address account) external view returns (string memory);
}

/// @notice Interface tối thiểu của Badge.sol (xem Badge.sol).
interface IBadge {
    function mintOrUpdateTier(address agent, uint256 score) external;
}

contract AgentAllowance {
    // --- Errors ---
    error NotAgentId();
    error BadSignature();
    error BadNonce();
    error Expired();
    error InvalidScore();
    error InvalidPeriod();
    error NotOwner();
    error ZeroAddress();
    error Paused();

    // --- Events ---
    event ScoreAttested(
        address indexed agent, uint256 score, uint64 periodStart, uint64 periodEnd, address verifier
    );
    event RoleChanged(string role, address indexed oldAddress, address indexed newAddress);
    // Ghi chú: Solidity không cho phép error và event cùng tên trong một contract,
    // nên 2 event Paused/Unpaused của SPEC được gộp thành PauseChanged (error Paused
    // được giữ nguyên vì test T7 kiểm tra revert Paused).
    event PauseChanged(bool paused, address indexed by);

    // --- Structs (SPEC §3.1) ---
    struct ScoreAttestation {
        address agent; // ví Agent ID được chấm điểm
        uint256 score; // 0-100
        uint64 periodStart; // đầu kỳ tính điểm (epoch giây)
        uint64 periodEnd; // cuối kỳ tính điểm (epoch giây)
        address verifier; // địa chỉ verifier đã ký
        uint64 attestedAt; // block.timestamp lúc attestScore() ghi on-chain
    }

    struct AgentProfile {
        address agent;
        string handle; // tên .ai, lấy từ contract Agent ID lúc attest lần đầu (cache để hiển thị)
        uint256 latestScore; // điểm đã xác nhận mới nhất
        uint64 lastAttestedAt;
        uint256 totalAttestations; // số lần attestScore() thành công của ví này
    }

    // --- EIP-712 ---
    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant SCORE_TYPEHASH = keccak256(
        "ScoreAttestation(address agent,uint256 score,uint64 periodStart,uint64 periodEnd,uint256 nonce,uint64 deadline)"
    );

    /// @notice Deadline tối đa verifier được ký: 15 phút (verifier đặt deadline = lúc ký + 15 phút).
    uint256 public constant VERIFIER_DEADLINE = 15 minutes;
    /// @notice Điểm tối đa.
    uint256 public constant MAX_SCORE = 100;

    // --- Immutable config ---
    IAgentID public immutable AGENT_ID;

    // --- Mutable roles ---
    address public owner; // Safe 2-of-3
    address public verifier; // địa chỉ verifier hiện tại
    address public badge; // địa chỉ Badge.sol, owner gán bằng setBadge (0 = chưa gán)
    bool public paused;

    // --- State ---
    mapping(address => ScoreAttestation) public latestScore; // điểm đã xác nhận mới nhất
    mapping(address => AgentProfile) public profiles; // hồ sơ tóm tắt
    mapping(address => uint256) public nonces; // nonce EIP-712 theo agent
    /// @notice Số ví đã có điểm xác nhận (chỉ tăng khi 1 ví attest lần đầu).
    uint256 public totalAgents;

    bytes32 private immutable _cachedDomainSeparator;
    uint256 private immutable _cachedChainId;

    // --- Modifiers ---
    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address agentId_, address owner_, address verifier_) {
        if (agentId_ == address(0) || owner_ == address(0) || verifier_ == address(0)) {
            revert ZeroAddress();
        }
        AGENT_ID = IAgentID(agentId_);
        owner = owner_;
        verifier = verifier_;
        _cachedChainId = block.chainid;
        _cachedDomainSeparator = _buildDomainSeparator();
    }

    /// @notice Lưu điểm đã xác nhận. Ai cũng có thể gửi giao dịch này (thường là chính
    /// ví agent qua frontend), nhưng chữ ký EIP-712 phải là của verifier hiện tại.
    /// Thứ tự kiểm tra: paused → deadline → nonce → chữ ký → score → kỳ → Agent ID.
    /// @dev Nonce tăng 1 sau mỗi lần attest thành công; nonce dùng lại revert BadNonce.
    function attestScore(
        address agent,
        uint256 score,
        uint64 periodStart,
        uint64 periodEnd,
        uint256 nonce,
        uint64 deadline,
        bytes calldata signature
    ) external {
        if (paused) revert Paused();
        if (block.timestamp > deadline) revert Expired();
        if (nonce != nonces[agent]) revert BadNonce();

        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                _domainSeparator(),
                keccak256(abi.encode(SCORE_TYPEHASH, agent, score, periodStart, periodEnd, nonce, deadline))
            )
        );
        if (_recover(digest, signature) != verifier) revert BadSignature();
        if (score > MAX_SCORE) revert InvalidScore();
        if (periodStart >= periodEnd) revert InvalidPeriod();
        // Cả ví được chấm lẫn ví gửi giao dịch đều phải có Agent ID (BRD FR-01).
        if (AGENT_ID.balanceOf(agent) == 0 || AGENT_ID.balanceOf(msg.sender) == 0) revert NotAgentId();

        nonces[agent] += 1;
        latestScore[agent] = ScoreAttestation({
            agent: agent,
            score: score,
            periodStart: periodStart,
            periodEnd: periodEnd,
            verifier: verifier,
            attestedAt: uint64(block.timestamp)
        });

        AgentProfile storage p = profiles[agent];
        if (p.totalAttestations == 0) {
            totalAgents += 1;
            p.agent = agent;
            p.handle = handleOf(agent);
        }
        p.latestScore = score;
        p.lastAttestedAt = uint64(block.timestamp);
        p.totalAttestations += 1;

        // Badge mint / đổi tier TỰ ĐỘNG (không claim riêng). Điểm < 50 không mint mới,
        // badge đã nhận được giữ nguyên tier (xem Badge.sol).
        if (badge != address(0)) {
            IBadge(badge).mintOrUpdateTier(agent, score);
        }

        emit ScoreAttested(agent, score, periodStart, periodEnd, verifier);
    }

    /// @notice Điểm đã xác nhận mới nhất của ví. Ví chưa từng attest trả struct rỗng
    /// (score = 0, attestedAt = 0); frontend phân biệt bằng attestedAt == 0.
    function getScore(address agent) external view returns (ScoreAttestation memory) {
        return latestScore[agent];
    }

    /// @notice Tên .ai của ví. Ví không có Agent ID trả "".
    function handleOf(address agent) public view returns (string memory) {
        if (AGENT_ID.balanceOf(agent) == 0) return "";
        try AGENT_ID.handleOf(agent) returns (string memory h) {
            return h;
        } catch {
            return "";
        }
    }

    // --- Owner: roles / pause ---

    /// @notice Đổi verifier (khi lộ khóa). Phát RoleChanged.
    function setVerifier(address newVerifier) external onlyOwner {
        if (newVerifier == address(0)) revert ZeroAddress();
        emit RoleChanged("verifier", verifier, newVerifier);
        verifier = newVerifier;
    }

    /// @notice Gán/đổi địa chỉ Badge.sol để attestScore() gọi mint/đổi tier. Phát RoleChanged.
    function setBadge(address badge_) external onlyOwner {
        if (badge_ == address(0)) revert ZeroAddress();
        emit RoleChanged("badge", badge, badge_);
        badge = badge_;
    }

    /// @notice Tạm dừng attest khi khẩn cấp. Không ảnh hưởng hàm view.
    function pause() external onlyOwner {
        paused = true;
        emit PauseChanged(true, msg.sender);
    }

    /// @notice Mở lại attest.
    function unpause() external onlyOwner {
        paused = false;
        emit PauseChanged(false, msg.sender);
    }

    // --- EIP-712 helpers ---

    function _buildDomainSeparator() internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                DOMAIN_TYPEHASH, keccak256(bytes("AgentAllowance")), keccak256(bytes("1")), block.chainid, address(this)
            )
        );
    }

    function _domainSeparator() internal view returns (bytes32) {
        if (block.chainid == _cachedChainId) return _cachedDomainSeparator;
        return _buildDomainSeparator();
    }

    function _recover(bytes32 digest, bytes calldata signature) internal pure returns (address) {
        if (signature.length != 65) return address(0);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (v != 27 && v != 28) return address(0);
        return ecrecover(digest, v, r, s);
    }
}
