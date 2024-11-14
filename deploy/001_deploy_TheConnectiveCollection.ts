import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {DeployFunction} from 'hardhat-deploy/types';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const {deployments, getNamedAccounts} = hre;
  const {deploy} = deployments;

  const {deployer} = await getNamedAccounts();

  await deploy('TheConnectiveCollection', {
    from: deployer,
    log: true,
    args: ['The Connective Collection', 'TCC'],
  });
};
export default func;
func.tags = ['TheConnectiveCollection'];
