// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

contract FreelanceEscrow {
    address public owner;
    uint public jobCount;

    enum Status { Created, Funded, Submitted, Completed, Disputed, Refunded }

    struct Job {
        uint jobId;
        address employer;
        address freelancer;
        string projectName;
        string description;
        uint amount;
        uint deadline;
        string workProof;
        Status status;
    }

    mapping(uint => Job) private jobs;

    // ใช้ดูประวัติและ Transaction
    event JobCreated(uint indexed jobId, address indexed employer, address indexed freelancer, uint amount);
    event Deposited(uint indexed jobId, uint amount);
    event WorkSubmitted(uint indexed jobId, string workProof);
    event PaymentReleased(uint indexed jobId, address indexed to, uint amount);
    event DisputeRaised(uint indexed jobId, address indexed by);
    event Refunded(uint indexed jobId, address indexed to, uint amount);

    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    modifier jobExists(uint _jobId) {
        require(jobs[_jobId].employer != address(0), "Job not found");
        _;
    }

    // ===== Create Contract =====
    // ผู้ว่าจ้างสร้างข้อตกลงจ้างงาน
    function createJob(
        string memory _projectName,
        string memory _description,
        address _freelancer,
        uint _amount,
        uint _durationDays
    ) public {
        require(_freelancer != address(0), "Invalid freelancer");
        require(_freelancer != msg.sender, "Freelancer cannot be employer");
        require(_amount > 0, "Amount must be greater than 0");
        require(_durationDays > 0, "Duration must be greater than 0");

        jobCount += 1;

        Job storage j = jobs[jobCount];
        j.jobId = jobCount;
        j.employer = msg.sender;
        j.freelancer = _freelancer;
        j.projectName = _projectName;
        j.description = _description;
        j.amount = _amount;
        j.deadline = block.timestamp + _durationDays * 1 days;
        j.status = Status.Created;

        emit JobCreated(jobCount, msg.sender, _freelancer, _amount);
    }

    // ===== Deposit Payment =====
    // ผู้ว่าจ้างฝากเงินค่าจ้าง
    function depositPayment(uint _jobId) public payable jobExists(_jobId) {
        Job storage j = jobs[_jobId];

        require(msg.sender == j.employer, "Only employer");
        require(j.status == Status.Created, "Already deposited");
        require(msg.value == j.amount, "Incorrect payment");

        j.status = Status.Funded;

        emit Deposited(_jobId, msg.value);
    }

    // Freelance ส่งหลักฐานงาน
    function submitWork(uint _jobId, string memory _workProof) public jobExists(_jobId) {
        Job storage j = jobs[_jobId];

        require(msg.sender == j.freelancer, "Only freelancer");
        require(j.status == Status.Funded, "Cannot submit work now");
        require(block.timestamp <= j.deadline, "Deadline passed");
        require(bytes(_workProof).length > 0, "Work proof required");

        j.workProof = _workProof;
        j.status = Status.Submitted;

        emit WorkSubmitted(_jobId, _workProof);
    }

    // ผู้ว่าจ้างอนุมัติ แล้วโอน ETH ให้ฟรีแลนซ์
    function approveAndRelease(uint _jobId) public jobExists(_jobId) {
        Job storage j = jobs[_jobId];

        require(msg.sender == j.employer, "Only employer");
        require(j.status != Status.Completed, "Already paid");
        require(j.status == Status.Submitted, "Work not ready for approval");

        j.status = Status.Completed;
        sendETH(j.freelancer, j.amount);

        emit PaymentReleased(_jobId, j.freelancer, j.amount);
    }

    // ผู้ว่าจ้างหรือฟรีแลนซ์แจ้งข้อพิพาท
    function raiseDispute(uint _jobId) public jobExists(_jobId) {
        Job storage j = jobs[_jobId];

        require(msg.sender == j.employer || msg.sender == j.freelancer, "Not a party");
        require(j.status == Status.Funded || j.status == Status.Submitted, "Cannot dispute now");

        j.status = Status.Disputed;

        emit DisputeRaised(_jobId, msg.sender);
    }

    // admin ตัดสิน: true = จ่ายให้ฟรีแลนซ์, false = คืนเงินผู้ว่าจ้าง
    function resolveDispute(uint _jobId, bool _payFreelancer) public onlyOwner jobExists(_jobId) {
        Job storage j = jobs[_jobId];

        require(j.status == Status.Disputed, "No dispute");

        if (_payFreelancer) {
            j.status = Status.Completed;
            sendETH(j.freelancer, j.amount);
            emit PaymentReleased(_jobId, j.freelancer, j.amount);
        } else {
            j.status = Status.Refunded;
            sendETH(j.employer, j.amount);
            emit Refunded(_jobId, j.employer, j.amount);
        }
    }

    function sendETH(address _to, uint _amount) internal {
        (bool sent, ) = payable(_to).call{value: _amount}("");
        require(sent, "ETH transfer failed");
    }

    // status: 0 = Created, 1 = Funded, 2 = Submitted, 3 = Completed, 4 = Disputed, 5 = Refunded
    function getJob(uint _jobId) public view jobExists(_jobId) returns (Job memory) {
        return jobs[_jobId];
    }

    function getJobCount() public view returns (uint) {
        return jobCount;
    }

    function getContractBalance() public view returns (uint) {
        return address(this).balance;
    }
}
