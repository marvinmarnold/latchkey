// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/PaypromptBalance.sol";

contract Deploy is Script {
    function run() external {
        address usdc = vm.envAddress("USDC_ADDRESS");
        address treasury = vm.envAddress("TREASURY_ADDRESS");
        address proxy = vm.envAddress("PROXY_ADDRESS");

        require(usdc != address(0), "USDC_ADDRESS required");
        require(treasury != address(0), "TREASURY_ADDRESS required");
        require(proxy != address(0), "PROXY_ADDRESS required");

        vm.startBroadcast();
        PaypromptBalance balance = new PaypromptBalance(usdc, treasury, proxy);
        vm.stopBroadcast();

        console.log("PaypromptBalance deployed at:", address(balance));
    }
}
