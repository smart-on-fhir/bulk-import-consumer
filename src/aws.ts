import AWS    from "aws-sdk"
import config from "./config"

AWS.config.update(config.aws);

export default AWS;
