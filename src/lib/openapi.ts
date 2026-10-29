const ref=(name:string)=>({$ref:`#/components/schemas/${name}`});
const text={type:'string'}, nullableText={type:['string','null']}, integer={type:'integer'}, nullableInteger={type:['integer','null']}, bool={type:'boolean'};
const object=(properties:Record<string,unknown>,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const body=(schema:unknown)=>({required:true,content:{'application/json':{schema}}});
const result=(schema:unknown,description='Success')=>({description,content:{'application/json':{schema}}});
const page={name:'page',in:'query',description:'Page number; 20 items per page. Values are bounded to 1–100000.',schema:{type:'integer',minimum:1,maximum:100000,default:1}};
const address={type:'string',pattern:'^[1-9][0-9]{0,18}$',description:'Post ID as a decimal string. New IDs have exactly 19 random digits; existing IDs are preserved.'};
const nullableAddress={...address,type:['string','null']};
const postId={name:'id',in:'path',required:true,description:'Public post ID, including reply IDs. Always handle IDs as strings.',schema:address};
const username={name:'username',in:'path',required:true,schema:{type:'string',pattern:'^[A-Za-z_][A-Za-z0-9_]{0,29}$'}};
const paginated=(item:unknown)=>object({items:{type:'array',items:item},page:integer,hasMore:bool});
const errors=Object.fromEntries([400,401,403,404,409,413,415,429,500,503].map(status=>[String(status),{...result(ref('Error'),({400:'Invalid input',401:'Missing, invalid or revoked key',403:'Account or ownership restriction',404:'Resource not found',409:'Conflict',413:'Request too large',415:'Expected application/json',429:'Rate limit exceeded',500:'Server error',503:'API disabled'} as Record<number,string>)[status]),...(status===429?{headers:{'Retry-After':{description:'Seconds until retry',schema:integer}}}:{})}]));
function operation(summary:string,tag:string,schema:unknown,extra:Record<string,unknown>={},status='200') {
  return {summary,tags:[tag],responses:{[status]:result(schema),...errors},...extra};
}
const profileFields={name:{type:'string',minLength:1,maxLength:80},bio:{type:'string',maxLength:300},image:{type:['string','null'],maxLength:2048,description:'Public HTTPS raster image URL, empty string or null to remove.'},coverImage:{type:['string','null'],maxLength:2048,description:'Public HTTPS raster image URL, empty string or null to remove.'}};
export const openapi={
  openapi:'3.1.0',
  info:{title:'Caledon Forum API',version:'1.0.0',description:'Manage forum activity using one API key per account. Generate the key in Settings → API. Keys remain valid until regenerated or revoked. Requires an active account with a username and verified email. Limit: 60 requests/minute/account, plus shared website action limits (10 publishes or 40 other mutations/minute). Posts and replies allow 25,000 Unicode code points each. Username is permanent. Login settings, key management and moderation are available only through the website. Cross-origin browser access is not supported.'},
  servers:[{url:'/api/v1'}],security:[{ApiKey:[]}],
  tags:[{name:'Account'},{name:'Profiles'},{name:'Posts'},{name:'Notifications'}],
  paths:{
    '/me':{
      get:operation('Read your account','Account',ref('Account')),
      patch:operation('Update your profile','Account',ref('Ok'),{requestBody:body(object(profileFields,[]))}),
    },
    '/profiles/{username}':{parameters:[username],get:operation('Read a public profile','Profiles',ref('Profile'))},
    '/profiles/{username}/posts':{parameters:[username],get:operation('List profile posts or replies','Profiles',ref('PostPage'),{parameters:[page,{name:'tab',in:'query',schema:{type:'string',enum:['posts','replies'],default:'posts'}}]})},
    '/posts':{
      get:operation('Read the feed','Posts',ref('PostPage'),{parameters:[page]}),
      post:operation('Publish a post or reply','Posts',ref('CreatedPost'),{requestBody:body(object({body:{...text,minLength:1,description:'Markdown, up to 25,000 Unicode code points. Whitespace-only content is rejected.'},parentId:{oneOf:[address,{type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER,description:'Legacy numeric input only; use strings for all new IDs.'}],description:'Public ID of the post to reply to; omit for a new thread.'}},['body']))},'201'),
    },
    '/posts/{id}':{
      parameters:[postId],get:operation('Read a post or reply','Posts',ref('Post')),
      patch:operation('Edit your post or reply','Posts',ref('Mutation'),{requestBody:body(object({body:{...text,minLength:1,description:'Markdown, up to 25,000 Unicode code points.'}}))}),
      delete:operation('Delete your post or reply','Posts',ref('Mutation')),
    },
    '/posts/{id}/replies':{parameters:[postId],get:operation('List conversation replies, oldest first','Posts',ref('PostPage'),{description:'For a reply ID, returns replies in its root conversation. Deleted entries remain as empty placeholders.',parameters:[page]})},
    '/posts/{id}/like':{parameters:[postId],put:operation('Like a post (idempotent)','Posts',ref('Like')),delete:operation('Unlike a post (idempotent)','Posts',ref('Like'))},
    '/posts/{id}/reports':{parameters:[postId],post:operation('Report a post','Posts',ref('Ok'),{requestBody:body(object({reason:{...text,minLength:5,maxLength:1000}}))})},
    '/notifications':{get:operation('List your notifications, newest first','Notifications',ref('NotificationPage'),{parameters:[page]})},
    '/notifications/read':{post:operation('Mark all your notifications as read','Notifications',ref('Ok'))},
  },
  components:{
    securitySchemes:{ApiKey:{type:'http',scheme:'bearer',bearerFormat:'API key',description:'Paste the full cfk_ key from Settings → API.'}},
    schemas:{
      Error:object({error:text}),Ok:object({ok:{type:'boolean',const:true}}),
      Mutation:object({ok:{type:'boolean',const:true},url:text}),CreatedPost:object({id:address,url:text}),Like:object({ok:{type:'boolean',const:true},liked:bool,likes:integer}),
      Account:object({id:text,username:nullableText,name:text,emailVerified:bool,image:nullableText,coverImage:nullableText,bio:text,role:text,suspended:bool}),
      Profile:object({username:text,name:text,image:nullableText,coverImage:nullableText,bio:text,createdAt:integer,isCaledonMember:bool}),
      Post:object({id:address,rootId:nullableAddress,parentId:nullableAddress,body:text,createdAt:integer,updatedAt:integer,deleted:bool,locked:bool,author:object({username:text,name:text,image:nullableText,isCaledonMember:bool}),likes:integer,replies:integer,liked:bool,url:text}),
      PostPage:paginated(ref('Post')),
      Notification:object({id:text,kind:{type:'string',enum:['reply','like']},postId:address,createdAt:integer,readAt:nullableInteger,actorUsername:nullableText,url:text}),
      NotificationPage:paginated(ref('Notification')),
    },
  },
};
