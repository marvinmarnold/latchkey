// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/PaypromptBalance.sol";

contract MockERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "insufficient");
        require(allowance[from][msg.sender] >= amount, "not approved");
        balanceOf[from] -= amount;
        allowance[from][msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "insufficient");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract PaypromptBalanceTest is Test {
    MockERC20 usdc;
    PaypromptBalance bal;

    address treasury = address(0xdead);
    address proxy = address(0xbeef);
    address caller = address(0xcafe);

    function setUp() public {
        usdc = new MockERC20();
        bal = new PaypromptBalance(address(usdc), treasury, proxy);
        usdc.mint(caller, 1_000_000); // 1 USDC
    }

    function test_deposit() public {
        vm.startPrank(caller);
        usdc.approve(address(bal), 1_000_000);
        bal.deposit(1_000_000);
        assertEq(bal.balances(caller), 1_000_000);
        vm.stopPrank();
    }

    function test_debit_splits_fee() public {
        vm.startPrank(caller);
        usdc.approve(address(bal), 1_000_000);
        bal.deposit(1_000_000);
        vm.stopPrank();

        uint256 gross = 100_000; // 0.1 USDC
        vm.prank(proxy);
        bal.debit(caller, gross);

        assertEq(bal.balances(caller), 900_000);
        assertEq(usdc.balanceOf(treasury), 1_000);   // 1%
        assertEq(usdc.balanceOf(proxy), 99_000);     // 99%
    }

    function test_debit_reverts_if_not_proxy() public {
        vm.expectRevert("not proxy");
        bal.debit(caller, 100_000);
    }

    function test_debit_reverts_insufficient_balance() public {
        vm.prank(proxy);
        vm.expectRevert("insufficient balance");
        bal.debit(caller, 1);
    }

    function test_withdraw() public {
        vm.startPrank(caller);
        usdc.approve(address(bal), 1_000_000);
        bal.deposit(1_000_000);
        bal.withdraw();
        assertEq(bal.balances(caller), 0);
        assertEq(usdc.balanceOf(caller), 1_000_000);
        vm.stopPrank();
    }
}
