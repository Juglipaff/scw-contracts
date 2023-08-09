import { expect } from "chai";
import { ethers, deployments } from "hardhat";
import { encodeTransfer } from "../../utils/testUtils";
import {
  getEntryPoint,
  getSmartAccountImplementation,
  getSmartAccountFactory,
  getMockToken,
  getEcdsaOwnershipRegistryModule,
  getSmartAccountWithModule,
  getVerifyingPaymaster,
} from "../../utils/setupHelper";
import {
  makeEcdsaModuleUserOp,
  makeEcdsaModuleUserOpWithPaymaster,
} from "../../utils/userOp";
import {
  BundlerTestEnvironment,
  Snapshot,
} from "../environment/bundlerEnvironment";

describe("Ownerless Smart Account Basics (with Bundler)", async () => {
  const [deployer, smartAccountOwner, charlie, verifiedSigner] =
    await ethers.getSigners();

  let environment: BundlerTestEnvironment;
  let defaultSnapshot: Snapshot;

  describe("Ownerless Smart Account Basics (with Bundler)", async () => {
    before(async function () {
      const chainId = (await ethers.provider.getNetwork()).chainId;
      if (chainId !== BundlerTestEnvironment.BUNDLER_ENVIRONMENT_CHAIN_ID) {
        this.skip();
      }

      environment = await BundlerTestEnvironment.getDefaultInstance();
      defaultSnapshot = await environment.snapshot();
    });

    afterEach(async function () {
      const chainId = (await ethers.provider.getNetwork()).chainId;
      if (chainId !== BundlerTestEnvironment.BUNDLER_ENVIRONMENT_CHAIN_ID) {
        this.skip();
      }

      await Promise.all([
        environment.revert(defaultSnapshot),
        environment.resetBundler(),
      ]);
    });

    const setupTests = deployments.createFixture(
      async ({ deployments, getNamedAccounts }) => {
        await deployments.fixture();

        const mockToken = await getMockToken();

        const ecdsaModule = await getEcdsaOwnershipRegistryModule();
        const EcdsaOwnershipRegistryModule = await ethers.getContractFactory(
          "EcdsaOwnershipRegistryModule"
        );

        const ecdsaOwnershipSetupData =
          EcdsaOwnershipRegistryModule.interface.encodeFunctionData(
            "initForSmartAccount",
            [await smartAccountOwner.getAddress()]
          );
        const smartAccountDeploymentIndex = 0;
        const userSA = await getSmartAccountWithModule(
          ecdsaModule.address,
          ecdsaOwnershipSetupData,
          smartAccountDeploymentIndex
        );

        await deployer.sendTransaction({
          to: userSA.address,
          value: ethers.utils.parseEther("10"),
        });

        await mockToken.mint(
          userSA.address,
          ethers.utils.parseEther("1000000")
        );

        return {
          entryPoint: await getEntryPoint(),
          smartAccountImplementation: await getSmartAccountImplementation(),
          smartAccountFactory: await getSmartAccountFactory(),
          mockToken: mockToken,
          ecdsaModule: ecdsaModule,
          userSA: userSA,
          verifyingPaymaster: await getVerifyingPaymaster(
            deployer,
            verifiedSigner
          ),
        };
      }
    );

    it("Can send an ERC20 Transfer userOp", async () => {
      const { entryPoint, mockToken, userSA, ecdsaModule } = await setupTests();

      const charlieTokenBalanceBefore = await mockToken.balanceOf(
        charlie.address
      );
      const tokenAmountToTransfer = ethers.utils.parseEther("0.5345");

      const userOp = await makeEcdsaModuleUserOp(
        "executeCall",
        [
          mockToken.address,
          ethers.utils.parseEther("0"),
          encodeTransfer(charlie.address, tokenAmountToTransfer.toString()),
        ],
        userSA.address,
        smartAccountOwner,
        entryPoint,
        ecdsaModule.address,
        {
          preVerificationGas: 50000,
        }
      );

      await environment.sendUserOperation(userOp, entryPoint.address);

      expect(await mockToken.balanceOf(charlie.address)).to.equal(
        charlieTokenBalanceBefore.add(tokenAmountToTransfer)
      );
    });

    it("Can send a Native Token Transfer userOp", async () => {
      const { entryPoint, userSA, ecdsaModule } = await setupTests();

      const charlieBalanceBefore = await charlie.getBalance();
      const amountToTransfer = ethers.utils.parseEther("0.5345");

      const userOp = await makeEcdsaModuleUserOp(
        "executeCall",
        [charlie.address, amountToTransfer, "0x"],
        userSA.address,
        smartAccountOwner,
        entryPoint,
        ecdsaModule.address,
        {
          preVerificationGas: 50000,
        }
      );

      await environment.sendUserOperation(userOp, entryPoint.address);
      expect(await charlie.getBalance()).to.equal(
        charlieBalanceBefore.add(amountToTransfer)
      );
    });

    // TODO: This test fails with the message paymaster uses banned opcode: BASEFEE
    it("Can send a userOp with Paymaster payment", async () => {
      const { entryPoint, mockToken, userSA, ecdsaModule, verifyingPaymaster } =
        await setupTests();

      const charlieTokenBalanceBefore = await mockToken.balanceOf(
        charlie.address
      );
      const tokenAmountToTransfer = ethers.utils.parseEther("0.6458");

      const userOp = await makeEcdsaModuleUserOpWithPaymaster(
        "executeCall",
        [
          mockToken.address,
          ethers.utils.parseEther("0"),
          encodeTransfer(charlie.address, tokenAmountToTransfer.toString()),
        ],
        userSA.address,
        smartAccountOwner,
        entryPoint,
        ecdsaModule.address,
        verifyingPaymaster,
        verifiedSigner,
        {
          preVerificationGas: 50000,
        }
      );

      await environment.sendUserOperation(userOp, entryPoint.address);

      expect(await mockToken.balanceOf(charlie.address)).to.equal(
        charlieTokenBalanceBefore.add(tokenAmountToTransfer)
      );
    });
  });
});
