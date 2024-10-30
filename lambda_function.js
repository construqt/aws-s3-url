const S3 = require('aws-sdk/clients/s3');

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*'
}

/**
 * Return an error response code with a message
 */
const invalid = (message, statusCode = 422) => {
    return {
      isBase64Encoded: false,
      statusCode,
      body: JSON.stringify({ message }),
      headers: {
        "Content-Type": "application/json",
        ...CORS
      }
    }
}




/**
 * Generate a random slug-friendly UUID
 */
const uuid =  (iterations = 1) =>  {
    let randomStr = Math.random().toString(36).substring(2, 15)
    return iterations <= 0 ? randomStr : randomStr + uuid(iterations - 1)
}

/**
 * Our primary Lambda handler.
 */
exports.handler = async (event) => {
    // Handle CORS preflight requests
    if (event.requestContext.http.method === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: CORS
        }
    }
    
    
    let Bucket = '';
    let path =  event.routeKey.split('/')[1]
    
    if(event.stageVariables.environment === 'staging'){
                Bucket = process.env.STAGING_BUCKET_NAME
    }else if(event.stageVariables.environment === 'prod'){
         Bucket = process.env.PROD_BUCKET_NAME
    }else{
        return invalid('Invalid env {staging/prod} ')
    }
    // Lets make sure this request has a fileName
    const body = JSON.parse(event.body)


    if(path === 'uploads'){
       return uploadFunction(body,Bucket) 
    }else if(path === 'download'){
        return downloadFunction(body,Bucket)
    }else{
        return invalid('Invalid url path {uploads/download }')
    }
    



}


const uploadFunction = async (body,Bucket) =>{
        // First, let's do some basic validation to ensure we recieved proper data
    if (!body && typeof body !== 'object' || !body.extension || !body.mime) {
        return invalid('Request must include "extension","mime" and properties.')
    }
    
    let filePath = `${uuid()}.${body.extension}`
    
    if (body.upload_type) {
    if ( body.upload_type == "certificate" && body.participant_name && body.participant_uuid && body.course_uuid){
        filePath = `certificates/${body.course_uuid}/${body.participant_name}${body.participant_uuid}.${body.extension}`
    }else if(body.upload_type == "cv" && body.jobseeker_name && body.jobseeker_uuid){
        filePath = `CVs/${body.jobseeker_name}${body.jobseeker_uuid}.${body.extension}`
    }else if(body.upload_type == "subsidy" && body.company_name && body.company_uuid){
        filePath = `subsidy/${body.company_name}${body.company_uuid}.${body.extension}`
    }else{
        return invalid('Request must include "course_uuid", "upload_type", "participant_uuid" and "participant_name" properties.')
    }
    }
    
    
        /**
     * These are the configuration options that we want to apply to the signed
     * 'putObject' URL we are going to generate. In this case, we want to add
     * a file with a public upload. The expiration here ensures this upload URL
     * is only valid for 5 minutes.
     */
    var params = {
        Bucket: Bucket,
        Key: filePath,
        Expires: 300,
        ACL: 'public-read'
    };
    
    
        /**
     * Now we create a new instance of the AWS SDK for S3. Notice how there are
     * no credentials here. This is because AWS will automatically use the
     * IAM role that has been assigned to this Lambda runtime.
     * 
     * The signature that gets generated uses the permissions assigned to this
     * role, so you must ensure that the Lambda role has permissions to
     * `putObject` on the bucket you specified above. If this is not true, the
     * signature will still get produced (getSignedUrl is just computational, it
     * does not actually check permissions) but when you try to PUT to the S3
     * bucket you will run into an Access Denied error.
     */
    const client = new S3({
        signatureVersion: 'v4',
        region: 'eu-central-1',
    })
    
    
        try {
        /**
         * Now we create the signed 'putObject' URL that will allow us to upload
         * files directly to our S3 bucket from the client-side.
         */
        const uploadUrl = await new Promise((resolve, reject) => {
            client.getSignedUrl('putObject', params, function (err, url) {
                return (err) ? reject(err) : resolve(url)
            });
        })

        // Finally, we return the uploadUrl in the HTTP response
        return {
            headers: {
                'Content-Type': 'application/json',
                ...CORS
            },
            statusCode: 200,
            body: JSON.stringify({ uploadUrl })
        }
      
    } catch (error) {
        // If there are any errors in the signature generation process, we
        // let the end user know with a 500.
        return invalid('Unable to create the signed URL.', 500)
    }
}


const downloadFunction = async (body,Bucket) =>{
    
    let fileName = ""

    if(body.download_type != 'certificate' && body.download_type != 'cv' && body.download_type != 'subsidy'){
    if (!body && typeof body !== 'object' || !body.extension || !body.fileName ) {
        return invalid('Request must include "extension" and "fileName" properties.')
    }

    fileName = `${body.fileName}.${body.extension}`;
    }else if (body.download_type === 'certificate') {
    if ( body.course_uuid){
        fileName = `certificates/${body.course_uuid}`
    }else{
        return invalid('Request must include "course_uuid" properties.')
    }
    }else if(body.download_type === 'cv'){
         fileName = `CVs/${body.cv_path}`
    }else if(body.download_type === 'subsidy'){
         fileName = `subsidy/${body.subsidy_path}`
    }
    
    
    var params = {
        Bucket: Bucket,
        Key: fileName,
        Expires: 604800
    };


    const client = new S3({
        Bucket: Bucket,
        region: 'eu-central-1',
    })

    try {
 
        const imageUrl = await new Promise((resolve, reject) => {
            client.getSignedUrl('getObject', params, function (err, url) {
                return (err) ? reject(err) : resolve(url)
            });
        })

        const data = imageUrl.toString('utf-8');
       
        return {
            headers: {
                'Content-Type': 'application/json',
                ...CORS
            },
            statusCode: 200,
            body: JSON.stringify({ data })
        }
    } catch (error) {

        return invalid(error, 500)
    }
}
