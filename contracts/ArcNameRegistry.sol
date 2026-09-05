// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ArcNameRegistry
 * @notice Minimal ENS-style name registry for the Arc Network testnet.
 *
 * Registers human-readable names (a-z, 0-9, 3-32 chars) to an owner address.
 * Names are unique — one owner per name. Ownership is transferable by the
 * owner only. v1 has no renewals: a name is yours until you transfer it.
 *
 * v2 adds the resolver layer: per-name key/value text records (avatar, url,
 * twitter, description, …), a per-owner "primary name" pointer, and a reverse
 * index (namesOf) so an address can be looked up by its human handle — and a
 * portfolio dashboard can list everything a wallet owns. Existing v1
 * functions and selectors are unchanged.
 *
 * ── Arc-specific notes (see https://docs.arc.io/arc/references/evm-differences) ──
 *  • The NATIVE token on Arc is USDC. msg.value and this contract's balance
 *    are native USDC, and the network takes gas in USDC automatically.
 *  • Native USDC uses 18 decimals on Arc (only the separate ERC-20 interface
 *    at 0x3600…0000 uses 6). The constructor price is therefore denominated
 *    in 18-decimal native USDC: "1 USDC" == 1e18. Pass 0 for free names.
 *  • Arc forbids native value transfers to address(0) and to burnt accounts —
 *    withdraw() sends to `admin`, so never set admin to address(0).
 *  • block.timestamp is not strictly increasing between Arc's sub-second
 *    blocks; timestamps here are informational only.
 */
contract ArcNameRegistry {
    /* ═══════════════════════════ Errors ═══════════════════════════ */

    error NameTooShort();
    error NameTooLong();
    error InvalidCharacters();
    error NameTaken(string name);
    error NotOwner();
    error ZeroAddress();
    error PriceNotMet();
    error Overpayment();
    error NothingToWithdraw();
    error WithdrawFailed();
    error EmptyKey();

    /* ═══════════════════════════ Events ═══════════════════════════ */

    event NameRegistered(bytes32 indexed id, string name, address indexed owner, uint256 pricePaid, uint256 timestamp);
    event NameTransferred(bytes32 indexed id, string name, address indexed from, address indexed to);
    event MetadataUpdated(bytes32 indexed id, string name, string metadataURI);
    event TextChanged(bytes32 indexed id, string name, string key, string value);
    event PrimaryNameSet(address indexed owner, string previous, string name);
    event PriceChanged(uint256 oldPrice, uint256 newPrice);
    event AdminChanged(address indexed previousAdmin, address indexed newAdmin);
    event Withdrawn(address indexed to, uint256 amount);

    /* ═══════════════════════════ Storage ═══════════════════════════ */

    struct Record {
        address owner;        // current owner of the name
        string name;          // normalized lowercase name
        string metadataURI;   // optional offchain pointer (avatar, profile, …)
        uint256 registeredAt; // block.timestamp of registration
    }

    address public admin;          // contract administrator
    uint256 public price;          // registration price in native USDC (18 dec); 0 = free
    uint256 public totalNames;     // number of registered names

    mapping(bytes32 id => Record) private _records; // id = keccak256(name)
    bytes32[] private _order;                       // records list, registration order

    // ── v2 · resolver layer ──────────────────────────────────────────
    mapping(bytes32 id => mapping(string key => string)) private _texts; // name id → key → value
    mapping(address => string) private _primary;                        // address → primary name
    mapping(address => bytes32[]) private _owned;                       // address → owned name ids (reverse index)

    /* ═══════════════════════════ Constructor ═══════════════════════════ */

    constructor(uint256 initialPrice) {
        admin = msg.sender;
        price = initialPrice;
        emit PriceChanged(0, initialPrice);
    }

    /* ═══════════════════════════ Internal ═══════════════════════════ */

    function _idOf(string calldata name) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(name));
    }

    function _validate(string calldata name) internal pure {
        bytes memory b = bytes(name);
        uint256 len = b.length;
        if (len < 3) revert NameTooShort();
        if (len > 32) revert NameTooLong();
        for (uint256 i = 0; i < len; ++i) {
            uint8 c = uint8(b[i]);
            bool isLower = c >= 0x61 && c <= 0x7A; // a-z
            bool isDigit = c >= 0x30 && c <= 0x39; // 0-9
            if (!isLower && !isDigit) revert InvalidCharacters();
        }
    }

    /// @notice Append `id` to `owner`'s reverse-index list.
    function _indexFor(address owner, bytes32 id) internal {
        _owned[owner].push(id);
    }

    /// @notice Remove `id` from `owner`'s reverse-index list (swap + pop).
    function _deindexFor(address owner, bytes32 id) internal {
        bytes32[] storage list = _owned[owner];
        uint256 len = list.length;
        for (uint256 i = 0; i < len; ++i) {
            if (list[i] == id) {
                list[i] = list[len - 1];
                list.pop();
                return;
            }
        }
    }

    /// @notice If `owner`'s primary name is exactly `name`, clear it.
    function _clearPrimaryIf(address owner, string calldata name) internal {
        string memory cur = _primary[owner];
        if (keccak256(bytes(cur)) == keccak256(bytes(name))) {
            _primary[owner] = "";
        }
    }

    /* ═══════════════════════════ Reads ═══════════════════════════ */

    /// @notice True when `name` is not yet registered.
    function isAvailable(string calldata name) external view returns (bool) {
        return _records[_idOf(name)].owner == address(0);
    }

    /// @notice Current owner of `name` (address(0) when unregistered).
    function ownerOf(string calldata name) external view returns (address) {
        return _records[_idOf(name)].owner;
    }

    /// @notice Metadata URI of `name`.
    function metadataOf(string calldata name) external view returns (string memory) {
        return _records[_idOf(name)].metadataURI;
    }

    /// @notice Number of registered names (records-list length).
    function recordCount() external view returns (uint256) {
        return _order.length;
    }

    /// @notice All registered names, in registration order (records list).
    function getAllNames() external view returns (string[] memory names) {
        names = new string[](_order.length);
        for (uint256 i = 0; i < _order.length; ++i) {
            names[i] = _records[_order[i]].name;
        }
    }

    /* ── v2 · resolver reads ─────────────────────────────────────── */

    /// @notice Value of `key` for `name` ("" when unset or name unknown).
    function text(string calldata name, string calldata key) external view returns (string memory) {
        return _texts[_idOf(name)][key];
    }

    /// @notice The owner's chosen primary name ("" when none is set).
    function primaryName(address owner) external view returns (string memory) {
        return _primary[owner];
    }

    /// @notice Every name owned by `owner`, in the order it was acquired.
    ///         Reverse-lookup index — powers "My Names" dashboards and
    ///         address → name resolution. O(n) per owner; fine on testnet.
    function namesOf(address owner) external view returns (string[] memory names) {
        bytes32[] storage list = _owned[owner];
        names = new string[](list.length);
        for (uint256 i = 0; i < list.length; ++i) {
            names[i] = _records[list[i]].name;
        }
    }

    /* ═══════════════════════════ Writes ═══════════════════════════ */

    /// @notice Register `name` to msg.sender. Pay `price` (native USDC,
    ///         18 decimals) when price > 0; the contract keeps the fee.
    function register(string calldata name) external payable returns (bytes32 id) {
        _validate(name);
        id = _idOf(name);
        if (_records[id].owner != address(0)) revert NameTaken(name);
        if (msg.value < price) revert PriceNotMet();
        if (msg.value > price) revert Overpayment();

        _records[id] = Record({ owner: msg.sender, name: name, metadataURI: "", registeredAt: block.timestamp });
        _order.push(id);
        _indexFor(msg.sender, id);
        ++totalNames;
        emit NameRegistered(id, name, msg.sender, msg.value, block.timestamp);
    }

    /// @notice Transfer `name` to `to`. Callable by the current owner only.
    function transfer(string calldata name, address to) external {
        if (to == address(0)) revert ZeroAddress();
        bytes32 id = _idOf(name);
        Record storage rec = _records[id];
        if (rec.owner != msg.sender) revert NotOwner();
        address from = rec.owner;
        if (from != to) {
            // keep the reverse index in sync so namesOf stays truthful
            _deindexFor(from, id);
            _indexFor(to, id);
            _clearPrimaryIf(from, name);
        }
        rec.owner = to;
        emit NameTransferred(id, name, from, to);
    }

    /// @notice Attach an offchain pointer to a name you own.
    function setMetadataURI(string calldata name, string calldata metadataURI) external {
        bytes32 id = _idOf(name);
        Record storage rec = _records[id];
        if (rec.owner != msg.sender) revert NotOwner();
        rec.metadataURI = metadataURI;
        emit MetadataUpdated(id, name, metadataURI);
    }

    /* ── v2 · resolver writes ────────────────────────────────────── */

    /// @notice Set `key` → `value` text record on a name you own.
    ///         Pass an empty `value` to clear the record.
    function setText(string calldata name, string calldata key, string calldata value) external {
        bytes32 id = _idOf(name);
        Record storage rec = _records[id];
        if (rec.owner != msg.sender) revert NotOwner();
        if (bytes(key).length == 0) revert EmptyKey();
        _texts[id][key] = value;
        emit TextChanged(id, name, key, value);
    }

    /// @notice Point your wallet's primary handle at `name` (must own it).
    ///         Only one primary per address — the latest call wins.
    function setPrimaryName(string calldata name) external {
        bytes32 id = _idOf(name);
        Record storage rec = _records[id];
        if (rec.owner != msg.sender) revert NotOwner();
        string memory previous = _primary[msg.sender];
        if (keccak256(bytes(previous)) != keccak256(bytes(name))) {
            _primary[msg.sender] = name;
            emit PrimaryNameSet(msg.sender, previous, name);
        }
    }

    /* ═══════════════════════════ Admin ═══════════════════════════ */

    function setPrice(uint256 newPrice) external {
        if (msg.sender != admin) revert NotOwner();
        emit PriceChanged(price, newPrice);
        price = newPrice;
    }

    function setAdmin(address newAdmin) external {
        if (msg.sender != admin) revert NotOwner();
        if (newAdmin == address(0)) revert ZeroAddress();
        emit AdminChanged(admin, newAdmin);
        admin = newAdmin;
    }

    /// @notice Send accumulated registration fees to the admin.
    function withdraw() external {
        if (msg.sender != admin) revert NotOwner();
        uint256 bal = address(this).balance;
        if (bal == 0) revert NothingToWithdraw();
        (bool ok, ) = payable(admin).call{ value: bal }("");
        if (!ok) revert WithdrawFailed();
        emit Withdrawn(admin, bal);
    }
}
