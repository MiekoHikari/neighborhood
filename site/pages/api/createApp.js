import Airtable from "airtable";

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(
  process.env.AIRTABLE_BASE_ID,
);

// Configure Next.js API to accept larger payloads
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',  // Increased size limit to handle larger images
    },
  },
};

// Max size for icon in bytes
const MAX_ICON_SIZE = 5 * 1024 * 1024; // 5MB

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const { token, name, icon, appLink, githubLink, description, images, hackatimeProjects, hackatimeProjectGithubLinks } = req.body;

  // Debug request
  console.log("==== DEBUG: CREATE APP REQUEST ====");
  console.log("App Name:", name);
  console.log("Icon provided:", !!icon);
  if (icon) {
    console.log("Icon type:", typeof icon);
    console.log("Icon length:", icon.length);
    // Limit icon preview to avoid flooding console
    console.log("Icon format:", icon.substring(0, 30) + "...");
  }

  if (!token || !name) {
    console.log("Missing required fields:", {
      hasToken: !!token,
      hasName: !!name
    });
    return res.status(400).json({ message: "Token and app name are required" });
  }

  try {
    // Get user data from token
    console.log("Fetching user data from token");
    const userRecords = await base(process.env.AIRTABLE_TABLE_ID)
      .select({
        filterByFormula: `{token} = '${token}'`,
        maxRecords: 1,
      })
      .firstPage();

    if (userRecords.length === 0) {
      console.log("No user found with this token");
      return res.status(404).json({ message: "User not found" });
    }

    const userId = userRecords[0].id;
    console.log("User found with ID:", userId);

    // If hackatimeProjects are provided, check and process them first
    let hackatimeProjectIds = [];
    if (hackatimeProjects && hackatimeProjects.length > 0) {
      console.log("Processing Hackatime projects:", hackatimeProjects);
      
      // First, check which projects already exist
      const existingProjects = await base("hackatimeProjects")
        .select({
          filterByFormula: `OR(${hackatimeProjects.map(name => `{name} = '${name}'`).join(",")})`,
        })
        .all();

      console.log("Found existing projects:", existingProjects.map(p => p.fields.name));

      // Create a map of existing project names to their IDs
      const existingProjectMap = new Map(
        existingProjects.map(p => [p.fields.name, p.id])
      );

      // For each project name
      for (const projectName of hackatimeProjects) {
        if (existingProjectMap.has(projectName)) {
          // If project exists, check if it already has apps
          const projectId = existingProjectMap.get(projectName);
          const project = existingProjects.find(p => p.id === projectId);
          
          // Check if project already has apps attributed
          if (project.fields.Apps && project.fields.Apps.length > 0) {
            return res.status(400).json({
              message: `Cannot create app: The project "${projectName}" is already attributed to another app.`,
              type: "project_already_attributed",
              projectName
            });
          }
          
          // If not attributed to any app, use its ID
          hackatimeProjectIds.push(projectId);
          console.log(`Using existing project ID for ${projectName}:`, projectId);

          // Check if user is already a neighbor of this project
          const neighbors = project.fields.neighbor || [];
          if (!neighbors.includes(userId)) {
            // Add user as neighbor if not already present
            console.log(`Adding user ${userId} as neighbor to existing project ${projectName}`);
            await base("hackatimeProjects").update(projectId, {
              neighbor: [...neighbors, userId],
              githubLink: hackatimeProjectGithubLinks?.[projectName] || "" // Add GitHub link
            });
          }
        } else {
          // If project doesn't exist, create it with the user as a neighbor
          console.log(`Creating new project: ${projectName}`);
          try {
            const newProject = await base("hackatimeProjects").create({
              name: projectName,
              neighbor: [userId],
              githubLink: hackatimeProjectGithubLinks?.[projectName] || "" // Add GitHub link
            });
            hackatimeProjectIds.push(newProject.id);
            console.log(`Created new project ${projectName} with ID:`, newProject.id);
          } catch (error) {
            console.error(`Failed to create project ${projectName}:`, error);
            throw error;
          }
        }
      }
    }

    // Create app fields without image data
    const appFields = {
      Name: name,
      "App Link": appLink || "",
      "Github Link": githubLink || "",
      Description: description || "",
      Neighbors: [userId],
      hackatimeProjects: hackatimeProjectIds
    };
    console.log("Prepared app fields:", Object.keys(appFields));
    
    // Handle icon URL
    if (icon && typeof icon === 'string') {
      console.log("Processing icon data");
      
      if (icon.startsWith('http://') || icon.startsWith('https://')) {
        console.log("Using direct URL for icon:", icon.substring(0, 50) + "...");
        appFields.Icon = icon;
        console.log("Set icon URL as text");
      } else {
        console.log("Invalid icon format - must be a URL");
        // Don't set invalid icon URLs
      }
    }
    
    // Handle images as comma-separated URLs
    if (images && Array.isArray(images)) {
      console.log("Processing images:", images.length);
      // Filter out any non-URL values and join with commas
      const validUrls = images.filter(url => 
        typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'))
      );
      if (validUrls.length > 0) {
        appFields.Images = validUrls.join(',');
        console.log("Set images as comma-separated URLs");
      }
    }
    
    // Create new app record in Apps table
    console.log("Creating app in Airtable...");
    let newApp;
    try {
      newApp = await base("Apps").create([
        {
          fields: appFields,
        },
      ]);
      console.log("App created successfully with ID:", newApp[0].id);
    } catch (createError) {
      console.error("Error creating app in Airtable:", createError);
      console.error("Error details:", {
        message: createError.message,
        statusCode: createError.statusCode
      });
      
      // If the error is related to icon attachment, try again without the icon
      if (createError.message && createError.message.includes("Icon")) {
        console.log("Trying without icon");
        // Remove icon from fields and try again
        delete appFields.Icon;
        
        newApp = await base("Apps").create([
          {
            fields: appFields,
          },
        ]);
        console.log("App created without icon");
      } else {
        // If it's not an icon issue, rethrow the error
        throw createError;
      }
    }

    // Get the full app details to return to client
    console.log("Fetching complete app details");
    const createdApp = await base("Apps").find(newApp[0].id);
    
    console.log("Has Icon after creation?", !!createdApp.fields.Icon);
    if (createdApp.fields.Icon) {
      console.log("Icon details after creation:", JSON.stringify(createdApp.fields.Icon));
    }

    return res.status(201).json({
      message: "App created successfully",
      app: {
        id: createdApp.id,
        name: createdApp.fields.Name || "",
        icon: createdApp.fields.Icon || null,
        appLink: createdApp.fields["App Link"] || "",
        githubLink: createdApp.fields["Github Link"] || "",
        description: createdApp.fields.Description || "",
        createdAt: createdApp.fields.createdAt || null,
        images: createdApp.fields.Images ? createdApp.fields.Images.split(',') : [],
        hackatimeProjects: createdApp.fields.hackatimeProjects || []
      },
    });
  } catch (error) {
    console.error("==== DEBUG: CREATE APP ERROR ====");
    console.error("Error creating app:", error);
    console.error("Error message:", error.message);
    console.error("Error name:", error.name);
    console.error("Status code:", error.statusCode);
    if (error.stack) {
      console.error("Stack trace:", error.stack);
    }
    return res.status(500).json({ 
      message: "Failed to create app", 
      error: error.message,
      statusCode: error.statusCode 
    });
  }
} 