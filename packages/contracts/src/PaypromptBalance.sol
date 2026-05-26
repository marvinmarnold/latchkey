// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @notice Deposit contract for Payprompt. Callers deposit USDC; the proxy debits per request.
contract PaypromptBalance {
    IERC20 public immutable usdc;
    address public immutable treasury;
    address public immutable proxy;

    mapping(address => uint256) public balances;

    event Deposited(address indexed caller, uint256 amount);
    event Debited(address indexed caller, uint256 gross, uint256 fee);
    event Withdrawn(address indexed caller, uint256 amount);

    constructor(address _usdc, address _treasury, address _proxy) {
        usdc = IERC20(_usdc);
        treasury = _treasury;
        proxy = _proxy;
    }

    modifier onlyProxy() {
        require(msg.sender == proxy, "not proxy");
        _;
    }

    /// @notice Deposit USDC into your balance. Caller must approve this contract first.
    function deposit(uint256 amount) external {
        require(amount > 0, "zero amount");
        usdc.transferFrom(msg.sender, address(this), amount);
        balances[msg.sender] += amount;
        emit Deposited(msg.sender, amount);
    }

    /// @notice Called by proxy after each request. Takes 1% fee to treasury.
    function debit(address caller, uint256 gross) external onlyProxy {
        require(balances[caller] >= gross, "insufficient balance");
        uint256 fee = gross / 100;
        uint256 net = gross - fee;
        balances[caller] -= gross;
        if (fee > 0) usdc.transfer(treasury, fee);
        if (net > 0) usdc.transfer(proxy, net);
        emit Debited(caller, gross, fee);
    }

    /// @notice Withdraw your full balance.
    function withdraw() external {
        uint256 amount = balances[msg.sender];
        require(amount > 0, "nothing to withdraw");
        balances[msg.sender] = 0;
        usdc.transfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }
}
