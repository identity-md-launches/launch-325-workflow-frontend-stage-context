// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockToken is ERC20 {
    constructor() ERC20("Test lot", "LOT") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract FeeToken is MockToken {
    uint256 public immutable feeBps;

    constructor(uint256 fee) {
        feeBps = fee;
    }

    function _update(address from, address to, uint256 amount) internal override {
        if (from != address(0) && to != address(0)) {
            uint256 fee = amount * feeBps / 10_000;
            super._update(from, address(0), fee);
            amount -= fee;
        }
        super._update(from, to, amount);
    }
}

contract HostileToken is MockToken {
    bool public rejectTransfers;
    bool public returnFalse;
    address public callbackTarget;
    bytes public callbackData;
    bool public bubbleFailure;
    bool public callbackAttempted;
    bool public callbackSucceeded;
    bytes public callbackResult;

    error TransferBlocked();
    error CallbackFailed();

    function configureTransfers(bool reject, bool falsy) external {
        rejectTransfers = reject;
        returnFalse = falsy;
    }

    function configureCallback(address target, bytes memory data, bool bubble) external {
        callbackTarget = target;
        callbackData = data;
        bubbleFailure = bubble;
        callbackAttempted = false;
        callbackSucceeded = false;
        delete callbackResult;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        if (rejectTransfers) revert TransferBlocked();
        if (returnFalse) return false;
        return super.transfer(to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        if (rejectTransfers) revert TransferBlocked();
        if (returnFalse) return false;
        return super.transferFrom(from, to, amount);
    }

    function _update(address from, address to, uint256 amount) internal override {
        super._update(from, to, amount);
        if (callbackTarget != address(0) && from != address(0) && to != address(0)) {
            callbackAttempted = true;
            (callbackSucceeded, callbackResult) = callbackTarget.call(callbackData);
            if (bubbleFailure && !callbackSucceeded) revert CallbackFailed();
        }
    }
}

/// @dev Old ERC-20s can transfer correctly without returning a boolean.
contract NoReturnToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external {
        allowance[msg.sender][spender] = amount;
    }

    function transfer(address to, uint256 amount) external {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
    }

    function transferFrom(address from, address to, uint256 amount) external {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
    }
}
