// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/LatchkeyBilling.sol";

/// @dev Minimal mock USDC that tracks transfer calls and can be configured to fail.
contract MockUSDC {
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => uint256) public balanceOf;
    bool private _failTransfer;
    bool private _failTransferFrom;

    function mint(address to, uint256 amount) external { balanceOf[to] += amount; }
    function approve(address spender, uint256 amount) external { allowance[msg.sender][spender] = amount; }
    function setFailTransfer(bool v) external { _failTransfer = v; }
    function setFailTransferFrom(bool v) external { _failTransferFrom = v; }

    function transfer(address to, uint256 amount) external returns (bool) {
        if (_failTransfer) return false;
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (_failTransferFrom) return false;
        require(allowance[from][msg.sender] >= amount, "allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract LatchkeyBillingTest is Test {
    MockUSDC usdc;
    LatchkeyBilling billing;
    address treasury = address(0x1);
    address proxyAddr = address(0x2);
    address caller = address(0x3);

    function setUp() public {
        usdc = new MockUSDC();
        billing = new LatchkeyBilling(address(usdc), treasury, proxyAddr);

        // Fund caller and approve the billing contract
        usdc.mint(caller, 10_000_000); // 10 USDC
        vm.prank(caller);
        usdc.approve(address(billing), type(uint256).max);
    }

    // --- Constructor guards ---

    function test_revertZeroUsdc() public {
        vm.expectRevert("usdc required");
        new LatchkeyBilling(address(0), treasury, proxyAddr);
    }

    function test_revertZeroTreasury() public {
        vm.expectRevert("treasury required");
        new LatchkeyBilling(address(usdc), address(0), proxyAddr);
    }

    function test_revertZeroProxy() public {
        vm.expectRevert("proxy required");
        new LatchkeyBilling(address(usdc), treasury, address(0));
    }

    // --- onlyProxy ---

    function test_revertIfNotProxy() public {
        vm.expectRevert("not proxy");
        billing.pull(caller, 100_000);
    }

    // --- Fee math ---

    function test_pull_feeMath_100k() public {
        // 100,000 atomic units → fee = 1,000 (1%), net = 99,000
        vm.prank(proxyAddr);
        billing.pull(caller, 100_000);

        assertEq(usdc.balanceOf(treasury),  1_000);
        assertEq(usdc.balanceOf(proxyAddr), 99_000);
        assertEq(usdc.balanceOf(caller),    10_000_000 - 100_000);
    }

    function test_pull_feeMath_zeroFee_smallAmount() public {
        // gross = 99 → fee = 0 (integer division), all goes to proxy
        vm.prank(proxyAddr);
        billing.pull(caller, 99);

        assertEq(usdc.balanceOf(treasury),  0);
        assertEq(usdc.balanceOf(proxyAddr), 99);
    }

    function test_pull_emitsEvent() public {
        vm.expectEmit(true, false, false, true);
        emit LatchkeyBilling.Pulled(caller, 100_000, 1_000);
        vm.prank(proxyAddr);
        billing.pull(caller, 100_000);
    }

    // --- Revert on zero ---

    function test_revertZeroAmount() public {
        vm.prank(proxyAddr);
        vm.expectRevert("zero amount");
        billing.pull(caller, 0);
    }

    // --- Insufficient allowance ---

    function test_revertInsufficientAllowance() public {
        // revoke allowance — MockUSDC reverts with "allowance" string
        vm.prank(caller);
        usdc.approve(address(billing), 0);

        vm.prank(proxyAddr);
        vm.expectRevert("allowance"); // MockUSDC reverts; real USDC returns false → "pull failed"
        billing.pull(caller, 100_000);
    }

    // --- transferFrom failure propagated ---

    function test_revertOnTransferFromFailure() public {
        usdc.setFailTransferFrom(true); // make transferFrom fail

        vm.prank(proxyAddr);
        vm.expectRevert("pull failed");
        billing.pull(caller, 100_000);
    }
}
