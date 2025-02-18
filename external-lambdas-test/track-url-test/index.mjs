import axios from 'axios'
import {v4 as uuid} from 'uuid'
// import AWS from 'aws-sdk'
// import aws4 from 'aws4';

/* api to get customer profile */
const getProfile = /* GraphQL */ `
  query GetProfile($enterpriseId: ID!, $mode: MODE!, $channel: CHANNEL!, $profileId: ID!) {
    getProfile(enterpriseId: $enterpriseId, mode: $mode, channel: $channel, profileId: $profileId) {
      enterpriseId
      mode
      profileId
      customer {
        enterpriseId
        mode
        customerId
        name
      }
      customerId
      channel
      createdAt
      updatedAt
    }
  }
`
/* api to get session data */
const searchSessionsWithConversation = /* GraphQL */ `
  query SearchSessionsWithConversation(
    $filter: SearchableSessionFilterInput
    $sort: [SearchableSessionSortInput]
    $limit: Int
    $nextToken: String
    $from: Int
    $aggregates: [SearchableSessionAggregationInput]
  ) {
    searchSessions(
      filter: $filter
      sort: $sort
      limit: $limit
      nextToken: $nextToken
      from: $from
      aggregates: $aggregates
    ) {
      items {
        enterpriseId
        mode
        sessionId
        customerId
        workspaceId
        flowId
        integrationId
        channel
        updatedAt
        createdAt
        assignment
        tags
        currentNodeId
        nextNodeId
        variables
        agentId
        preview
        nodeId
        validationCount
        campaignMessageId
        active
        initiatedBy
        conversationByDate(sortDirection: ASC, limit: 20) {
          items {
            conversationId
            createdBy
            createdAt
            content
            conversationInfo {
              deliveredAt
              readAt
              submittedAt
              channelMessageId
            }
          }
        }
        __typename
      }
      nextToken
      total

      __typename
    }
  }
`

const createEventLabel = /* GraphQL */ `
  mutation CreateEventLabel(
    $input: CreateEventLabelInput!
    $condition: ModelEventLabelConditionInput
  ) {
    createEventLabel(input: $input, condition: $condition) {
      enterpriseId
      labelId
      mode
      createdAt
      updatedAt
      conversationId
      sessionId
      session {
        enterpriseId
        mode
        sessionId
        customerId
        workspaceId
        flowId
        integrationId
        channel
        updatedAt
        createdAt
        assignment
        tags
        currentNodeId
        nextNodeId
        variables
        agentId
        preview
        nodeId
        validationCount
        campaignMessageId
        active
        initiatedBy
        federatedLiveToCustomerId
        federatedRole
        healthTableId
        metaConversationId
        referrer
        referrerType
        language
        __typename
      }
      interactionId
      flowId
      nodeId
      campaignId
      customerId
      customer {
        enterpriseId
        mode
        customerId
        name
        email
        firstName
        lastName
        variables
        tags
        parent
        parentId
        createdAt
        updatedAt
        blacklisted
        blacklistReason
        blacklistedAt
        __typename
      }
      workspaceId
      type
      label
      value
      previousLabel
      previousValue
      __typename
    }
  }
`

export const handler = async (event) => {
  const APPSYNC_ENDPOINT = process.env.APPSYNC_ENDPOINT
  const APPSYNC_API_KEY = process.env.APPSYNC_API_KEY

  // const docClient = new AWS.DynamoDB.DocumentClient();
  // const params = {
  //     TableName: 'Conversation-pwfixhlf6zg6dcu65kphar6kw4-dev',
  //     ScanIndexForward: false,
  //     Limit: 1
  // };

  // const result = await docClient.scan(params).promise();
  // const latestItem = result.Items[0];

  console.log('event', event)
  // const clientIp = event.requestContext.identity.sourceIp;

  const queryParams = event.queryStringParameters

  if (queryParams && queryParams.redirect_url) {
    const decodedUrl = decodeURIComponent(queryParams.redirect_url)

    const trimmedUrl = decodedUrl.replace(/^.*?(https:\/\/.*)$/, '$1')
    console.log('redirect_url:', trimmedUrl)

    const customerId = queryParams.customerId
    console.log('customerId: ', customerId)
    const enterpriseId = queryParams.enterpriseId
    const label = queryParams.data_point_name
    const value = queryParams.data_point_value

    let customerData = null
    let session = null

    if (queryParams.enterpriseId && queryParams.customerId) {
      const {data: response} = await axios.post(
        APPSYNC_ENDPOINT,
        {
          query: getProfile,
          variables: {
            enterpriseId: enterpriseId,
            mode: 'TEST',
            channel: 'WHATSAPP',
            profileId: customerId,
          },
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': APPSYNC_API_KEY,
          },
        }
      )

      customerData = response?.data?.getProfile
    }

    console.log('customerData', JSON.stringify(customerData))

    if (customerData) {
      const {data: response} = await axios.post(
        APPSYNC_ENDPOINT,
        {
          query: searchSessionsWithConversation,
          variables: {
            filter: {
              enterpriseId: {
                eq: enterpriseId,
              },
              mode: {
                eq: 'TEST',
              },
              customerId: {
                eq: customerData?.customer?.customerId,
              },
            },
            sort: [
              {
                field: 'updatedAt',
                direction: 'desc',
              },
            ],
          },
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': APPSYNC_API_KEY,
          },
        }
      )

      console.log('latest data: ', JSON.stringify(response?.data?.searchSessions?.items[0]))
      session = response?.data?.searchSessions?.items[0]
    }

    if (session) {
      const nextNodeId = session?.nextNodeId
      const conversations = session?.conversationByDate?.items

      let latestInteraction = null
      let conversationId = null
      let nodeId = null
      let latestTime = null

      conversations.forEach((conversation) => {
        const content = JSON.parse(conversation?.content)
        // if (content.nodeId === nextNodeId) {
        // }
        const createdAt = new Date(conversation?.createdAt)
        if (!latestTime || createdAt > latestTime) {
          latestTime = createdAt
          latestInteraction = content?.interactionId
          conversationId = conversation?.conversationId
          nodeId = content?.nodeId
        }
      })

      if (latestInteraction) {
        console.log('Latest Interaction ID:', latestInteraction, conversationId)
      } else {
        console.log('No matching nodeId found.')
      }

      try {
        const {data: response} = await axios.post(
          APPSYNC_ENDPOINT,
          {
            query: createEventLabel,
            variables: {
              input: {
                enterpriseId: session?.enterpriseId,
                mode: session?.mode,
                labelId: uuid(),
                sessionId: session?.sessionId,
                flowId: session?.flowId,
                customerId: session?.customerId,
                workspaceId: session?.workspaceId,
                type: 'DATA_POINT',
                label: label,
                value: value,
                conversationId: conversationId,
                nodeId: nodeId,
                interactionId: latestInteraction,
              },
            },
          },
          {
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': APPSYNC_API_KEY,
            },
          }
        )

        console.log('response:+++++', response)
      } catch (err) {
        console.log(`error while creating event lable: ${err}`)
      }
    }

    return {
      statusCode: 302,
      headers: {
        Location: decodedUrl,
        // 'X-Client-IP': clientIp
      },
      body: '',
    }
  }

  return {
    statusCode: 400,
    body: JSON.stringify({message: 'redirect_url is required'}),
  }
}
