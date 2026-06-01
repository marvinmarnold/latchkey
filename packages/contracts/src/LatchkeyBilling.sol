// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @notice Pull-payment billing contract for Latchkey.
/// Callers approve this contract once (ERC-20 approve); the proxy pulls USDC
/// from their wallet whenever their off-chain accrued debt crosses the threshold.
/// No vault — no balances mapping. The proxy manages all accounting off-chain.
///
/// @dev Security notes (Phase-2.5 hardening items, documented for future work):
///   - `proxy` is a hot key held by the proxy process. Consider a dedicated
///     signer or multisig before mainnet.
///   - No reentrancy guard needed here: transferFrom + transfer use USDC (well-
///     known non-reentrant on Base), but add OZ ReentrancyGuard before other tokens.
contract LatchkeyBilling {
    IERC20  public immutable usdc;
    address public immutable treasury;
    address public immutable proxy;

    event Pulled(address indexed caller, uint256 gross, uint256 fee);

    modifier onlyProxy() {
        require(msg.sender == proxy, "not proxy");
        _;
    }

    constructor(address _usdc, address _treasury, address _proxy) {
        require(_usdc     != address(0), "usdc required");
        require(_treasury != address(0), "treasury required");
        require(_proxy    != address(0), "proxy required");
        usdc     = IERC20(_usdc);
        treasury = _treasury;
        proxy    = _proxy;
    }

    /// @notice Pull pre-approved USDC from caller. 1% fee to treasury, rest to proxy.
    /// Single transferFrom into the contract, then split — one allowance decrement,
    /// clean accounting, one event.
    function pull(address caller, uint256 gross) external onlyProxy {
        require(gross > 0, "zero amount");
        require(usdc.transferFrom(caller, address(this), gross), "pull failed");
        uint256 fee = gross / 100;
        if (fee > 0) {
            require(usdc.transfer(treasury, fee), "fee transfer failed");
        }
        require(usdc.transfer(proxy, gross - fee), "net transfer failed");
        emit Pulled(caller, gross, fee);
    }
}
