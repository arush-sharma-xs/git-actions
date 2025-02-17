#!/bin/bash

# Exit immediately if a command exits with a non-zero status, and treat unset variables as errors
set -euo pipefail

value=`cat env.json`
isLayer=`echo $value | jq -r '.layer'`

# Variables
layerName="genAI-layer"
functionName="askAQuestion-genAI"
role="arn:aws:iam::941128203839:role/service-role/askAQuestion-genAI-role-s0w7y2uv" 
handlerFile="lambda_handler.py"
runtime="python3.12"
zipFile="lambda_handler.zip"

layer_arn=$(aws lambda list-layers --query "Layers[?LayerName=='$layerName'].LatestMatchingVersion.LayerVersionArn" --output text)

if [ "$isLayer" = "true" ] 
then
    echo "Installing required packages for Lambda Layer..."
    pip install -r requirements.txt \
        --platform manylinux2014_x86_64 \
        --only-binary=:all: \
        --target python/ \
        --upgrade \
        --python-version 3.12

    if [ $? -ne 0 ]; then
        echo "Failed to install required packages."
        exit 1
    fi

    echo "Creating Lambda Layer package..."
    zip -r python.zip python

    if [ $? -ne 0 ]; then
        echo "Failed to create ZIP file for Lambda Layer."
        exit 1
    fi

    # Publish the Lambda Layer
    echo "Publishing Lambda Layer..."


    if [ "$layer_arn" == "None" ]; then
        echo "Lambda Layer doesn't exist. Publishing new layer..."
        layer_arn=$(aws lambda publish-layer-version \
            --layer-name "$layerName" \
            --zip-file "fileb://python.zip" \
            --compatible-runtimes "$runtime" \
            --query "LayerVersionArn" --output text)
    else
        echo "Lambda Layer exists. Publishing a new version..."
        layer_arn=$(aws lambda publish-layer-version \
            --layer-name "$layerName" \
            --zip-file "fileb://python.zip" \
            --compatible-runtimes "$runtime" \
            --query "LayerVersionArn" --output text)
    fi
fi

# Create Lambda Function Deployment Package
echo "Zipping the lambda handler..."
zip -j "$zipFile" "$handlerFile"

if [ $? -ne 0 ]; then
    echo "Failed to create Lambda function deployment package."
    exit 1
fi

# Deploy the Lambda Function
echo "Deploying Lambda function..."
echo "Checking if Lambda function exists..."
function_exists=$(aws lambda get-function --function-name "$functionName" --query "Configuration.FunctionName" --output text || echo "None")

if [ "$function_exists" == "$functionName" ]; then
    echo "Lambda function exists. Updating function code..."
    aws lambda update-function-code \
        --function-name "$functionName" \
        --zip-file "fileb://$zipFile"

    sleep 10

    aws lambda update-function-configuration \
        --function-name "$functionName" \
        --layers "$layer_arn"
else
    echo "Lambda function doesn't exist. Creating new function..."
    aws lambda create-function \
        --function-name "$functionName" \
        --runtime "$runtime" \
        --role $role \
        --handler "lambda_handler.lambda_handler" \
        --zip-file "fileb://$zipFile" \
        --timeout 120 \
        --memory-size 128 \
        --layers "$layer_arn"
fi

if [ $? -ne 0 ]; then
    echo "Failed to deploy Lambda function."
    exit 1
fi

echo "Lambda function and layer deployed successfully!"
